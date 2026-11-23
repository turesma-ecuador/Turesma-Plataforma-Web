const assert = require("node:assert/strict");
const test = require("node:test");

const normalize = (sql) => sql.replace(/\s+/g, " ").trim().toLowerCase();
const response = () => ({
  statusCode: 200,
  body: null,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(body) {
    this.body = body;
    return this;
  },
});

const queries = [];
const pool = { query: async () => ({ rows: [], rowCount: 0 }) };
let assignedAdminId = null;
let linkedRequerimientoId = 5;
let linkedCotizacionId = null;
const dbModule = require.resolve("../dist/config/db");
require.cache[dbModule] = {
  id: dbModule,
  filename: dbModule,
  loaded: true,
  exports: pool,
  children: [],
  paths: [],
};

const { listMensajes, sendMensaje } = require("../dist/controllers/comunicacion.controller");

const setup = () => {
  queries.length = 0;
  assignedAdminId = null;
  linkedRequerimientoId = 5;
  linkedCotizacionId = null;
  pool.query = async (sql, params = []) => {
    const query = normalize(sql);
    queries.push({ query, params });
    if (query.includes("from requerimientos_personalizados where id = $1")) {
      return { rows: [{ usuario_id: 99 }], rowCount: 1 };
    }
    if (query.includes("from reservas r left join requerimientos_personalizados")) {
      return { rows: [{ usuario_id: 99, requerimiento_id: linkedRequerimientoId, cotizacion_id: linkedCotizacionId }], rowCount: 1 };
    }
    if (query.includes("from cotizaciones where id = $1")) {
      return { rows: [{ usuario_id: 99 }], rowCount: 1 };
    }
    if (query.includes("select rol, activo from usuarios where id = $1")) {
      return { rows: [{ rol: params[0] === 1 ? "admin" : "cliente", activo: true }], rowCount: 1 };
    }
    if (query.includes("case when m.sender_user_id = $3")) {
      return assignedAdminId ? { rows: [{ id: assignedAdminId }], rowCount: 1 } : { rows: [], rowCount: 0 };
    }
    if (query.includes("where lower(rol) = 'admin'")) {
      return { rows: [{ id: 1 }], rowCount: 1 };
    }
    if (query.includes("select id from usuarios where id = $1 and coalesce(activo, true) = true")) {
      return { rows: [{ id: params[0] }], rowCount: 1 };
    }
    if (query.startsWith("insert into mensajes_comunicacion")) {
      return {
        rows: [{
          id: 41,
          sender_user_id: params[0],
          recipient_user_id: params[1],
          mensaje: params[2],
          reserva_id: params[3],
          link_type: params[4],
          link_id: params[5],
          creado_en: "2026-11-23T12:00:00.000Z",
          leido: false,
        }],
        rowCount: 1,
      };
    }
    if (query.startsWith("update mensajes_comunicacion")) return { rows: [], rowCount: 1 };
    if (query.includes("from mensajes_comunicacion m")) {
      return {
        rows: [{
          id: 41,
          sender_user_id: 99,
          recipient_user_id: 1,
          mensaje: "¿Puedo llevar maletas?",
          sender_nombre: "Cliente",
          sender_rol: "cliente",
          es_mio: params[2] === 99,
        }],
        rowCount: 1,
      };
    }
    return { rows: [], rowCount: 0 };
  };
};

test("el cliente puede iniciar una conversación ligada a su requerimiento", async () => {
  setup();
  const res = response();
  await sendMensaje({
    user: { id: 99 },
    body: { link_type: "requerimiento", link_id: 5, mensaje: "¿Puedo llevar maletas?" },
  }, res);

  assert.equal(res.statusCode, 201);
  assert.equal(res.body.mensaje.recipient_user_id, 1);
  assert.equal(res.body.mensaje.link_type, "requerimiento");
  assert.equal(res.body.mensaje.link_id, 5);
  assert.deepEqual(queries.find(({ query }) => query.startsWith("insert into mensajes_comunicacion")).params, [
    99, 1, "¿Puedo llevar maletas?", null, "requerimiento", 5,
  ]);
});

test("una reserva creada desde un requerimiento conserva el mismo hilo", async () => {
  setup();
  const res = response();
  await sendMensaje({
    user: { id: 1 },
    body: { link_type: "reserva", link_id: 700, mensaje: "La propuesta incluye equipaje." },
  }, res);

  assert.equal(res.statusCode, 201);
  assert.equal(res.body.mensaje.recipient_user_id, 99);
  assert.equal(res.body.mensaje.reserva_id, 700);
  assert.equal(res.body.mensaje.link_type, "requerimiento");
  assert.equal(res.body.mensaje.link_id, 5);
});

test("una reserva de cotización conserva el hilo de la cotización", async () => {
  setup();
  linkedRequerimientoId = null;
  linkedCotizacionId = 23;
  const res = response();
  await sendMensaje({
    user: { id: 1 },
    body: { link_type: "reserva", link_id: 701, mensaje: "Confirmamos el servicio." },
  }, res);

  assert.equal(res.statusCode, 201);
  assert.equal(res.body.mensaje.link_type, "cotizacion");
  assert.equal(res.body.mensaje.link_id, 23);
  assert.equal(res.body.mensaje.reserva_id, 701);
});

test("los mensajes posteriores se dirigen al administrador que ya participa en el hilo", async () => {
  setup();
  assignedAdminId = 7;
  const res = response();
  await sendMensaje({
    user: { id: 99 },
    body: { link_type: "requerimiento", link_id: 5, mensaje: "Gracias por la respuesta." },
  }, res);

  assert.equal(res.statusCode, 201);
  assert.equal(res.body.mensaje.recipient_user_id, 7);
  assert.equal(queries.some(({ query }) => query.includes("where lower(rol) = 'admin'")), false);
});

test("un cliente no puede leer mensajes de otro requerimiento", async () => {
  setup();
  const res = response();
  await listMensajes({
    user: { id: 55 },
    query: { link_type: "requerimiento", link_id: "5" },
  }, res);

  assert.equal(res.statusCode, 403);
  assert.equal(queries.some(({ query }) => query.includes("from mensajes_comunicacion m")), false);
});

test("la lectura contextual filtra por hilo y devuelve el autor del mensaje", async () => {
  setup();
  const res = response();
  await listMensajes({
    user: { id: 99 },
    query: { link_type: "requerimiento", link_id: "5" },
  }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body[0].es_mio, true);
  assert.equal(res.body[0].sender_nombre, "Cliente");
  assert.ok(queries.some(({ query, params }) =>
    query.includes("where m.link_type = $1 and m.link_id = $2") && params[0] === "requerimiento" && params[1] === 5
  ));
});
