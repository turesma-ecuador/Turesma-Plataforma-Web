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

const pool = { query: async () => ({ rows: [], rowCount: 0 }), connect: async () => client };
let client;
let queryLog;
let scenario;

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
require.cache[notificationsModule] = {
  id: notificationsModule,
  filename: notificationsModule,
  loaded: true,
  exports: {
    crearNotificacion: async () => true,
    notificarAdmins: async () => true,
  },
  children: [],
  paths: [],
};

const {
  crearSolicitudReprogramacion,
  proponerReprogramacion,
  rechazarSolicitudReprogramacion,
  aceptarPropuestaReprogramacion,
} = require("../dist/controllers/reprogramaciones.controller");

const reservation = {
  id: 501,
  usuario_id: 99,
  estado: "confirmada",
  estado_pago: "pagado",
  total: "100.00",
  monto_pagado: "100.00",
  fecha_reserva: "2027-02-10",
  fecha_salida: "2027-02-10T08:00:00",
  fecha_servicio: "2027-02-10T08:00:00",
  fecha_fin: null,
  fecha_regreso: null,
  hora_salida: "08:00",
  num_personas: 2,
  vehiculo_id: null,
  conductor_id: null,
  estado_operativo: null,
  recogido: false,
};
const groupOperation = {
  id: 900,
  requerimiento_id: 44,
  grupo_numero: 2,
  unidad_numero: 1,
  fecha_programada: "2027-02-10",
  fecha_fin_programada: null,
  hora_inicio: "08:00",
  hora_fin: "10:00",
  pasajeros: 2,
  estado: "asignada",
  vehiculo_id: null,
  conductor_id: null,
  vehiculo_asociado_id: null,
  subcontratacion_estado: "no_requerida",
};

const setup = (kind) => {
  scenario = kind;
  queryLog = [];
  client = {
    async query(sql, params = []) {
      const query = normalize(sql);
      queryLog.push({ query, params });
      if (query === "begin" || query === "commit" || query === "rollback") return { rows: [], rowCount: 0 };
      if (query.includes("from reservas where id = $1 and usuario_id = $2 for update")) {
        return { rows: [reservation], rowCount: 1 };
      }
      if (query.includes("from solicitudes_reprogramacion s join reservas r")) {
        if (scenario === "accept") {
          return {
            rows: [{
              ...reservation,
              id: 77,
              reserva_id: 501,
              usuario_id: 99,
              grupo_numero: 2,
              estado: "propuesta_cliente",
              fecha_propuesta: "2027-02-20",
              hora_propuesta: "10:00:00",
              fecha_anterior: "2027-02-10",
              hora_anterior: "08:00:00",
              reserva_estado: "confirmada",
              estado_pago: "pagado",
              total: "100.00",
              monto_pagado: "100.00",
              estado_operativo: null,
              recogido: false,
            }],
            rowCount: 1,
          };
        }
        return {
          rows: [{
            ...reservation,
            id: 77,
            reserva_id: 501,
            usuario_id: 99,
            grupo_numero: null,
            estado: "pendiente_admin",
            fecha_anterior: "2027-02-10",
            hora_anterior: "08:00:00",
            reserva_estado: "confirmada",
          }],
          rowCount: 1,
        };
      }
      if (query.includes("from operaciones") && query.includes("where reserva_id = $1 and estado <> 'cancelada'")) {
        const hasGroupOperations = ["create", "accept"].includes(scenario);
        return { rows: hasGroupOperations ? [groupOperation] : [], rowCount: hasGroupOperations ? 1 : 0 };
      }
      if (query.includes("from solicitudes_reprogramacion") && query.includes("estado in ('pendiente_admin', 'propuesta_cliente')")) {
        return { rows: [], rowCount: 0 };
      }
      if (query.includes("insert into solicitudes_reprogramacion")) {
        return {
          rows: [{
            id: 77,
            reserva_id: 501,
            grupo_numero: 2,
            estado: "pendiente_admin",
            fecha_anterior: "2027-02-10",
            hora_anterior: "08:00:00",
            fecha_solicitada: "2027-02-20",
            hora_solicitada: "10:00:00",
            creado_en: "2026-11-23T12:00:00.000Z",
          }],
          rowCount: 1,
        };
      }
      if (query.includes("select id from vehiculos v")) return { rows: [], rowCount: 0 };
      if (query.includes("select o.id from operaciones o")) return { rows: [], rowCount: 0 };
      if (query.includes("select r.id from reservas r")) return { rows: [], rowCount: 0 };
      if (query.includes("select count(*)::int as total from vehiculos v")) {
        return { rows: [{ total: scenario === "unavailable" ? 0 : 1 }], rowCount: 1 };
      }
      if (query.includes("update solicitudes_reprogramacion") && query.includes("rechazada_admin")) {
        return { rows: [{ id: 77, reserva_id: 501, usuario_id: 99, grupo_numero: 2 }], rowCount: 1 };
      }
      if (query.startsWith("update")) return { rows: [], rowCount: 1 };
      if (query.startsWith("insert into reserva_historial")) return { rows: [], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    },
    release() {},
  };
  pool.connect = async () => client;
};

test("solicitar cambio de fecha guarda una propuesta pendiente sin modificar la reserva", async () => {
  setup("create");
  const res = response();
  await crearSolicitudReprogramacion({
    user: { id: 99 },
    params: { id: "501" },
    body: { grupo_numero: 2, fecha: "2027-02-20", hora: "10:00" },
  }, res);

  assert.equal(res.statusCode, 201);
  assert.match(res.body.message, /fecha actual se mantiene/i);
  assert.equal(queryLog.some(({ query }) => query.startsWith("update reservas")), false);
  assert.equal(queryLog.some(({ query }) => query.startsWith("update operaciones")), false);
});

test("administración no puede proponer una fecha sin unidades disponibles", async () => {
  setup("unavailable");
  const res = response();
  await proponerReprogramacion({
    user: { id: 1 },
    params: { solicitudId: "77" },
    body: { fecha_propuesta: "2027-02-20", hora_propuesta: "10:00", nota_admin: "Fecha alternativa" },
  }, res);

  assert.equal(res.statusCode, 409);
  assert.match(res.body.error, /no hay suficientes unidades disponibles/i);
  assert.equal(queryLog.some(({ query }) => query.includes("set estado = 'propuesta_cliente'")), false);
});

test("al marcar la solicitud como no disponible, la reserva conserva su fecha", async () => {
  setup("reject");
  const res = response();
  await rechazarSolicitudReprogramacion({
    user: { id: 1 },
    params: { solicitudId: "77" },
    body: { nota_admin: "No hay unidades para ese día" },
  }, res);

  assert.equal(res.statusCode, 200);
  assert.match(res.body.message, /fecha original se mantiene/i);
  assert.equal(queryLog.some(({ query }) => query.startsWith("update reservas")), false);
  assert.equal(queryLog.some(({ query }) => query.startsWith("update operaciones")), false);
});

test("aceptar una alternativa aplica la fecha solo al grupo solicitado", async () => {
  setup("accept");
  const res = response();
  await aceptarPropuestaReprogramacion({ user: { id: 99 }, params: { solicitudId: "77" } }, res);

  assert.equal(res.statusCode, 200);
  assert.match(res.body.message, /servicio seleccionado/i);
  assert.equal(queryLog.some(({ query }) => query.startsWith("update reservas")), false);
  assert.equal(queryLog.some(({ query }) => query.startsWith("update cotizaciones")), false);
  const operationUpdate = queryLog.find(({ query }) => query.startsWith("update operaciones"));
  assert.ok(operationUpdate);
  assert.equal(operationUpdate.params[0], "2027-02-20");
  assert.equal(operationUpdate.params[1], "2027-02-10");
  assert.ok(queryLog.some(({ query }) => query.startsWith("update requerimientos_personalizados")));
});
