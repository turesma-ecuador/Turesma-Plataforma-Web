const test = require("node:test");
const assert = require("node:assert/strict");

const queries = [];
let savedRequest = null;
let nextReservationId = 900;
const client = {
  async query(sql, params = []) {
    const query = sql.replace(/\s+/g, " ").trim().toLowerCase();
    queries.push({ query, params });
    if (query === "begin" || query === "commit" || query === "rollback") return { rows: [], rowCount: 0 };
    if (query.startsWith("select * from requerimientos_personalizados")) {
      if (!savedRequest || Number(params[0]) !== savedRequest.id
        || query.includes("and usuario_id = $2") && Number(params[1]) !== savedRequest.usuario_id) {
        return { rows: [], rowCount: 0 };
      }
      return { rows: [{ ...savedRequest }], rowCount: 1 };
    }
    if (query.startsWith("update requerimientos_personalizados")) {
      if (query.includes("set reserva_id = $1")) {
        savedRequest.reserva_id = params[0];
        savedRequest.estado = "pago_pendiente";
      } else {
        savedRequest.estado = params[0];
        savedRequest.precio_final = params[1];
        savedRequest.service_groups = JSON.parse(params[2]);
        savedRequest.respuesta_admin = params[3];
      }
      return { rows: [{ ...savedRequest }], rowCount: 1 };
    }
    if (query.startsWith("insert into reservas")) {
      return { rows: [{ id: nextReservationId++ }], rowCount: 1 };
    }
    throw new Error(`Unexpected client query: ${query}`);
  },
  release() {},
};
const pool = {
  async connect() { return client; },
  async query(sql, params = []) {
    const query = sql.replace(/\s+/g, " ").trim().toLowerCase();
    queries.push({ query, params });
    if (query.startsWith("insert into requerimientos_personalizados")) {
      const groups = JSON.parse(params[11]);
      savedRequest = {
        id: 44,
        usuario_id: params[0],
        estado: "pendiente",
        service_groups: groups,
        detalles: params[10],
        reserva_id: null,
        precio_final: null,
      };
      return { rows: [{ id: 44, estado: "pendiente", creado_en: "2026-11-03T20:00:00Z" }], rowCount: 1 };
    }
    if (query.startsWith("select r.id, r.organizacion")) {
      return { rows: [{ id: 44, usuario_id: params[0], estado: "pendiente" }], rowCount: 1 };
    }
    throw new Error(`Unexpected requerimiento query: ${query}`);
  },
};

const dbModule = require.resolve("../dist/config/db");
require.cache[dbModule] = {
  id: dbModule,
  filename: dbModule,
  loaded: true,
  exports: pool,
  children: [],
  paths: [],
};

const notificationsModule = require.resolve("../dist/config/notificaciones");
const sentNotifications = [];
require.cache[notificationsModule] = {
  id: notificationsModule,
  filename: notificationsModule,
  loaded: true,
  exports: {
    async notificarAdmins(...args) { sentNotifications.push(["admins", ...args]); },
    async crearNotificacion(...args) { sentNotifications.push(["client", ...args]); },
  },
  children: [],
  paths: [],
};

const requerimientoMailerModule = require.resolve("../dist/config/requerimientoMailer");
const sentProposalEmails = [];
require.cache[requerimientoMailerModule] = {
  id: requerimientoMailerModule,
  filename: requerimientoMailerModule,
  loaded: true,
  exports: {
    async notificarPropuestaRequerimiento(...args) { sentProposalEmails.push(args); },
  },
  children: [],
  paths: [],
};

const proformaModule = require.resolve("../dist/config/proforma");
require.cache[proformaModule] = {
  id: proformaModule,
  filename: proformaModule,
  loaded: true,
  exports: {
    async buildProformaDataRequerimiento() { return null; },
    async generarProformaPDF() { return Buffer.from("%PDF-test"); },
  },
  children: [],
  paths: [],
};

const {
  crearRequerimiento,
  listarMisRequerimientos,
  actualizarRequerimientoAdmin,
  aceptarPropuestaRequerimiento,
} = require("../dist/controllers/requerimientos-personalizados.controller");

const response = () => ({
  statusCode: 200,
  body: null,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});

test("valida y guarda un requerimiento personalizado asociado al cliente autenticado", async () => {
  const invalidRes = response();
  await crearRequerimiento({
    user: { id: 7 },
    body: {
      detalles: "demanda de buses",
      grupos_servicio: [{ cantidad_vehiculos: 1, fecha_servicio: "2026-02-31", simultaneo: false }],
    },
  }, invalidRes);
  assert.equal(invalidRes.statusCode, 400);

  const res = response();
  await crearRequerimiento({
    user: { id: 7 },
    body: {
      organizacion: "Empresa de prueba",
      detalles: "Se requieren diez buses para trasladar personal.",
      grupos_servicio: [
        {
          cantidad_vehiculos: 10,
          tipo_vehiculo: "Bus",
          pasajeros_por_vehiculo: 40,
          fecha_servicio: "2026-11-10",
          fecha_fin: "2026-11-11",
          hora_salida: "08:30",
          origen: "Manta",
          destino: "Quito",
          paradas: "Portoviejo",
          detalles: "Recoger al personal en la terminal.",
          simultaneo: true,
        },
        {
          cantidad_vehiculos: 1,
          tipo_vehiculo: "SUV",
          pasajeros_por_vehiculo: 4,
          fecha_servicio: "2026-11-10",
          fecha_fin: "",
          hora_salida: "09:00",
          origen: "Manta",
          destino: "Montecristi",
          paradas: "",
          detalles: "",
          simultaneo: false,
        },
      ],
    },
  }, res);

  assert.equal(res.statusCode, 201);
  assert.equal(res.body.id, 44);
  assert.equal(queries.at(-1).params[0], 7);
  assert.equal(queries.at(-1).params[2], 11);
  assert.equal(queries.at(-1).params[3], "Varios");
  assert.equal(JSON.parse(queries.at(-1).params[11])[0].simultaneo, true);
  assert.equal(sentNotifications[0][0], "admins");
});

test("cotiza cada grupo con subtotal propio y publica el total autoritativo", async () => {
  const listRes = response();
  await listarMisRequerimientos({ user: { id: 7 } }, listRes);
  assert.equal(listRes.body[0].usuario_id, 7);
  assert.equal(queries.at(-1).params[0], 7);

  const updateRes = response();
  await actualizarRequerimientoAdmin({
    params: { id: "44" },
    user: { id: 2 },
    body: {
      estado: "propuesta_enviada",
      precios_grupo: [2500, 900],
      respuesta_admin: "Incluye coordinación de las unidades indicadas.",
    },
  }, updateRes);
  assert.equal(updateRes.statusCode, 200);
  assert.equal(updateRes.body.estado, "propuesta_enviada");
  assert.equal(updateRes.body.precio_final, 3400);
  assert.equal(updateRes.body.service_groups[0].precio_total, 2500);
  assert.equal(updateRes.body.service_groups[1].precio_total, 900);
  assert.equal(sentNotifications.at(-1)[0], "client");
  assert.equal(sentNotifications.at(-1)[2], 7);
  assert.match(sentNotifications.at(-1)[3], /Total: \$3400\.00/);
  assert.equal(sentNotifications.at(-1)[5], "requerimiento");
  assert.equal(sentNotifications.at(-1)[6], 44);
  assert.deepEqual(sentProposalEmails, [[updateRes.body]]);
});

test("acepta la propuesta de forma idempotente y crea una reserva maestra por el total", async () => {
  const unauthorized = response();
  await aceptarPropuestaRequerimiento({ params: { id: "44" }, user: { id: 8 } }, unauthorized);
  assert.equal(unauthorized.statusCode, 404);
  assert.equal(queries.filter(item => item.query.startsWith("insert into reservas")).length, 0);

  const first = response();
  await aceptarPropuestaRequerimiento({ params: { id: "44" }, user: { id: 7 } }, first);
  assert.equal(first.statusCode, 201);
  assert.equal(first.body.reserva_id, 900);
  assert.equal(savedRequest.estado, "pago_pendiente");
  assert.equal(queries.some(item => item.query.startsWith("insert into reservas")), true);

  const second = response();
  await aceptarPropuestaRequerimiento({ params: { id: "44" }, user: { id: 7 } }, second);
  assert.equal(second.statusCode, 200);
  assert.equal(second.body.reserva_id, 900);
  assert.equal(queries.filter(item => item.query.startsWith("insert into reservas")).length, 1);
});
