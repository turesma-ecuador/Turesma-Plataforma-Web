const test = require("node:test");
const assert = require("node:assert/strict");

const requestRow = {
  id: 14,
  reserva_id: 14,
  estado: "pendiente_admin",
  reserva_estado: "confirmada",
  estado_pago: "pagado",
  monto_pagado: "150.00",
  despacho_preparado: true,
  despacho_operacion_id: 10,
  despacho_estado: "en_curso",
  bloqueo_propuesta: "El viaje ya comenzó o fue completado; no se puede cotizar el cambio desde aquí.",
};
let queryText = "";

const pool = {
  async query(sql) {
    queryText = sql.replace(/\s+/g, " ").trim().toLowerCase();
    return { rows: [requestRow], rowCount: 1 };
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
require.cache[notificationsModule] = {
  id: notificationsModule,
  filename: notificationsModule,
  loaded: true,
  exports: { crearNotificacion: async () => {}, notificarAdmins: async () => {} },
  children: [],
  paths: [],
};

const { listarSolicitudesCambioDestinoAdmin } = require("../dist/controllers/cambios-destino.controller");

test("expone el bloqueo por despacho para que administración no envíe una propuesta inválida", async () => {
  const res = {
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
  };

  await listarSolicitudesCambioDestinoAdmin({}, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body[0].despacho_preparado, true);
  assert.equal(res.body[0].despacho_operacion_id, 10);
  assert.equal(res.body[0].despacho_estado, "en_curso");
  assert.match(res.body[0].bloqueo_propuesta, /viaje ya comenzó/);
  assert.match(queryText, /estado not in \('cancelada', 'completada'\)/);
  assert.match(queryText, /left join lateral/);
  assert.match(queryText, /as bloqueo_propuesta/);
});
