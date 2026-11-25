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
      assert.match(query, /^insert into requerimientos_personalizados \(usuario_id, organizacion, cantidad_vehiculos, tipo_vehiculo, pasajeros_por_vehiculo, fecha_servicio, fecha_fin, hora_salida, origen, destino, detalles, service_groups\) values \(\$1, \$2, \$3, \$4, \$5, \$6, \$7, \$8, \$9, \$10, \$11, \$12\)/);
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
let notificationResult = true;
require.cache[notificationsModule] = {
  id: notificationsModule,
  filename: notificationsModule,
  loaded: true,
  exports: {
    async notificarAdmins(...args) { sentNotifications.push(["admins", ...args]); },
    async crearNotificacion(...args) {
      sentNotifications.push(["client", ...args]);
      return notificationResult;
    },
  },
  children: [],
  paths: [],
};

const requerimientoMailerModule = require.resolve("../dist/config/requerimientoMailer");
const sentProposalEmails = [];
const sentResponseEmails = [];
let proposalEmailResult = { sent: true };
let responseEmailResult = { sent: true };
require.cache[requerimientoMailerModule] = {
  id: requerimientoMailerModule,
  filename: requerimientoMailerModule,
  loaded: true,
  exports: {
    async notificarRespuestaRequerimiento(...args) {
      sentResponseEmails.push(args);
      return responseEmailResult;
    },
    async notificarPropuestaRequerimiento(...args) {
      sentProposalEmails.push(args);
      return proposalEmailResult;
    },
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
          itinerario: [{ destino: "Cuenca", fecha_llegada: "2026-11-10", dias_estadia: 1, hora_salida: "10:00" }],
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
  assert.deepEqual(JSON.parse(queries.at(-1).params[11])[0].itinerario, [
    { destino: "Cuenca", fecha_llegada: "2026-11-10", hora_salida: "10:00", dias_estadia: 1 },
  ]);
  assert.equal(sentNotifications[0][0], "admins");
});

test("responder guarda el texto, cambia el estado automáticamente e informa fallos de entrega", async () => {
  notificationResult = false;
  responseEmailResult = { sent: false, reason: "not_configured" };

  const emptyResponse = response();
  await actualizarRequerimientoAdmin({
    params: { id: "44" },
    user: { id: 2 },
    body: { action: "send_response", respuesta_admin: "   " },
  }, emptyResponse);
  assert.equal(emptyResponse.statusCode, 400);

  const updateRes = response();
  await actualizarRequerimientoAdmin({
    params: { id: "44" },
    user: { id: 2 },
    body: { action: "send_response", respuesta_admin: "Podemos coordinar el servicio." },
  }, updateRes);
  assert.equal(updateRes.statusCode, 200);
  assert.equal(updateRes.body.estado, "respondido");
  assert.equal(updateRes.body.respuesta_admin, "Podemos coordinar el servicio.");
  assert.deepEqual(updateRes.body.delivery, {
    inApp: { sent: false },
    email: { sent: false, reason: "not_configured" },
  });
  assert.equal(sentNotifications.at(-1)[0], "client");
  assert.match(sentNotifications.at(-1)[3], /Podemos coordinar el servicio/);
  assert.equal(sentResponseEmails.at(-1)[0].respuesta_admin, "Podemos coordinar el servicio.");
});

test("enviar propuesta calcula el total y notifica con el estado automático", async () => {
  notificationResult = true;
  responseEmailResult = { sent: true };
  proposalEmailResult = { sent: true };
  const listRes = response();
  await listarMisRequerimientos({ user: { id: 7 } }, listRes);
  assert.equal(listRes.body[0].usuario_id, 7);
  assert.equal(queries.at(-1).params[0], 7);

  const updateRes = response();
  await actualizarRequerimientoAdmin({
    params: { id: "44" },
    user: { id: 2 },
    body: {
      action: "send_proposal",
      precios_grupo: [2500, 900],
      respuesta_admin: "Incluye coordinación de las unidades indicadas.",
    },
  }, updateRes);
  assert.equal(updateRes.statusCode, 200);
  assert.equal(updateRes.body.estado, "propuesta_enviada");
  assert.equal(updateRes.body.precio_final, 3400);
  assert.equal(updateRes.body.service_groups[0].precio_total, 2500);
  assert.equal(updateRes.body.service_groups[1].precio_total, 900);
  assert.deepEqual(updateRes.body.delivery, {
    inApp: { sent: true },
    email: { sent: true },
  });
  assert.equal(sentNotifications.at(-1)[0], "client");
  assert.equal(sentNotifications.at(-1)[2], 7);
  assert.match(sentNotifications.at(-1)[3], /Total: \$3400\.00/);
  assert.equal(sentNotifications.at(-1)[5], "requerimiento");
  assert.equal(sentNotifications.at(-1)[6], 44);
  assert.equal(sentProposalEmails.length, 1);
  assert.equal(sentProposalEmails[0][0].estado, "propuesta_enviada");
  assert.equal(sentProposalEmails[0][0].precio_final, 3400);
  assert.equal(sentProposalEmails[0][0].respuesta_admin, "Incluye coordinación de las unidades indicadas.");
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
  const reservationInsert = queries.find(item => item.query.startsWith("insert into reservas"));
  assert.ok(reservationInsert);
  assert.match(reservationInsert.query, /fecha_servicio, fecha_salida\) values \(\$1, \$2, \$3, \$3, \$4, \$5, 'pendiente_pago', \$6, \$7, 'varios', \$8, 0, 'pendiente', \$9, \$10::timestamp\)/);
  assert.equal(reservationInsert.params[1], "2026-11-10");
  assert.equal(reservationInsert.params[8], "2026-11-10");
  assert.equal(reservationInsert.params[9], "2026-11-10 08:30");

  const second = response();
  await aceptarPropuestaRequerimiento({ params: { id: "44" }, user: { id: 7 } }, second);
  assert.equal(second.statusCode, 200);
  assert.equal(second.body.reserva_id, 900);
  assert.equal(queries.filter(item => item.query.startsWith("insert into reservas")).length, 1);
});

test("permite ofertar solo algunos grupos y conserva los no incluidos sin precio", async () => {
  const original = { ...savedRequest, service_groups: savedRequest.service_groups };
  savedRequest.reserva_id = null;
  savedRequest.estado = "pendiente";

  const updateRes = response();
  await actualizarRequerimientoAdmin({
    params: { id: "44" },
    user: { id: 2 },
    body: {
      action: "send_proposal",
      grupos_incluidos: [2],
      precios_grupo: [2500, 900],
      motivos_grupos_no_incluidos: { "1": "No hay disponibilidad para esas fechas" },
      respuesta_admin: "Podemos atender el segundo grupo.",
    },
  }, updateRes);

  assert.equal(updateRes.statusCode, 200);
  assert.equal(updateRes.body.precio_final, 900);
  assert.equal(updateRes.body.service_groups[0].incluido_en_propuesta, false);
  assert.equal(updateRes.body.service_groups[0].precio_total, null);
  assert.equal(updateRes.body.service_groups[0].motivo_no_inclusion, "No hay disponibilidad para esas fechas");
  assert.equal(updateRes.body.service_groups[1].incluido_en_propuesta, true);
  assert.equal(updateRes.body.service_groups[1].precio_total, 900);
  savedRequest = original;
});

test("al aceptar una propuesta parcial prepara el pago solo para los grupos incluidos", async () => {
  const original = savedRequest;
  savedRequest = {
    ...original,
    reserva_id: null,
    estado: "propuesta_enviada",
    precio_final: 900,
    service_groups: [
      { ...original.service_groups[0], incluido_en_propuesta: false, precio_total: null },
      { ...original.service_groups[1], incluido_en_propuesta: true, precio_total: 900 },
    ],
  };
  nextReservationId = 950;

  const acceptRes = response();
  await aceptarPropuestaRequerimiento({ params: { id: "44" }, user: { id: 7 } }, acceptRes);

  assert.equal(acceptRes.statusCode, 201);
  assert.equal(acceptRes.body.reserva_id, 950);
  const reservationInsert = queries.find(item => item.query.startsWith("insert into reservas") && item.params[4] === 900);
  assert.ok(reservationInsert);
  assert.equal(reservationInsert.params[3], 4);
  assert.equal(reservationInsert.params[8], "2026-11-10");
  assert.equal(reservationInsert.params[9], "2026-11-10 09:00");
  savedRequest = original;
});
