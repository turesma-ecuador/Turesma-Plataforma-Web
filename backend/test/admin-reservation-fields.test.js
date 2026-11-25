const assert = require("node:assert/strict");
const test = require("node:test");

const queries = [];
let currentReservation;

const pool = {
  async query(sql, params = []) {
    const query = sql.replace(/\s+/g, " ").trim().toLowerCase();
    queries.push({ query, params });

    if (query.startsWith("select column_name, is_nullable from information_schema.columns")) {
      return { rows: [{ is_nullable: "YES" }], rowCount: 1 };
    }
    if (query.startsWith("select to_regclass('public.hoteles')")) {
      return { rows: [{ hoteles_table: null }], rowCount: 1 };
    }
    if (query.startsWith("select id, hotel_id from usuarios")) {
      return { rows: [{ id: 7, hotel_id: null }], rowCount: 1 };
    }
    if (query.startsWith("select * from reservas")) {
      return { rows: [{ ...currentReservation }], rowCount: 1 };
    }
    if (query.startsWith("select id from pagos_reserva") || query.startsWith("select id from operaciones")) {
      return { rows: [], rowCount: 0 };
    }
    if (query.startsWith("select id from usuarios")) {
      return { rows: [{ id: 7 }], rowCount: 1 };
    }
    if (query.startsWith("insert into reservas")) {
      return { rows: [{ id: 55, ...Object.fromEntries(params.map((value, index) => [String(index), value])) }], rowCount: 1 };
    }
    if (query.startsWith("insert into cotizaciones")) {
      return { rows: [{ id: 89, valor_ofrecido: null }], rowCount: 1 };
    }
    if (query.startsWith("insert into reserva_historial")) return { rows: [], rowCount: 1 };
    if (query.startsWith("update reservas set")) {
      return { rows: [{ id: 55 }], rowCount: 1 };
    }
    throw new Error(`Unexpected query: ${query}`);
  },
};

const installMock = (specifier, exports) => {
  const id = require.resolve(specifier);
  require.cache[id] = {
    id,
    filename: id,
    loaded: true,
    exports,
    children: [],
    paths: [],
  };
};

installMock("../dist/config/db", pool);
installMock("../dist/config/catalogoHelpers", {
  async isReservaEstadoValido() { return true; },
});
installMock("../dist/config/reservaEstadoAuto", {
  async syncReservaEstadosAutomaticos() {},
});
installMock("../dist/config/reservaMailer", {
  async notificarClienteReserva() {},
});
installMock("../dist/config/notificaciones", {
  async crearNotificacion() {},
  async notificarAdmins() {},
});
installMock("../dist/config/pricing", {
  async getPricing() { return {}; },
  async roadDistanceKm() { return 0; },
  calculateQuote() { return { total: 0 }; },
});

const { crearReserva, editarReserva } = require("../dist/controllers/admin/catalogo-reservas.admin.controller");
const { crearCotizacion } = require("../dist/controllers/admin/cotizaciones.admin.controller");

const response = () => ({
  statusCode: 200,
  body: null,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});

const reservationBody = {
  usuario_id: 7,
  fecha_reserva: "2026-07-01",
  fecha_salida: "2026-07-06T09:30",
  fecha_servicio: "2026-07-06T09:30",
  fecha_llegada: "2026-07-06T14:00",
  hora_salida: "09:30",
  fecha_fin: "2026-07-08",
  fecha_regreso: null,
  hora_regreso: null,
  num_personas: 3,
  num_viajes: 2,
  modalidad_servicio: "varios_dias",
  duracion_horas: null,
  duracion_estimada_minutos: null,
  tipo_vehiculo: "van",
  total: 250,
  origen: "Quito",
  destino: "Baños",
  notas: "Equipaje adicional",
};

test("crea una reserva administrativa con los detalles completos del servicio", async () => {
  queries.length = 0;
  const res = response();

  await crearReserva({ body: { ...reservationBody, estado: "pendiente_pago" }, user: { id: 2 } }, res);

  assert.equal(res.statusCode, 201);
  const insert = queries.find(({ query }) => query.startsWith("insert into reservas"));
  assert.ok(insert);
  const columns = insert.query.match(/insert into reservas \((.*?)\) values/)[1].split(", ");
  const value = (column) => insert.params[columns.indexOf(column)];

  assert.equal(value("fecha_salida"), "2026-07-06 09:30");
  assert.equal(value("fecha_llegada"), "2026-07-06 14:00");
  assert.equal(value("fecha_servicio"), "2026-07-06 09:30");
  assert.equal(value("fecha_fin"), "2026-07-08");
  assert.equal(value("hora_salida"), "09:30");
  assert.equal(value("num_viajes"), 2);
  assert.equal(value("modalidad_servicio"), "varios_dias");
  assert.equal(value("tipo_vehiculo"), "van");
  assert.equal(value("notas"), "Equipaje adicional");
});

test("rechaza un regreso en otra fecha sin hora de recogida", async () => {
  queries.length = 0;
  const res = response();

  await crearReserva({
    body: {
      ...reservationBody,
      modalidad_servicio: "dia",
      fecha_fin: null,
      fecha_regreso: "2026-07-08",
      hora_regreso: null,
    },
  }, res);

  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /fecha y la hora de regreso/);
  assert.equal(queries.some(({ query }) => query.startsWith("insert into reservas")), false);
});

test("crea una reserva de ida y regreso con fecha y hora de recogida", async () => {
  queries.length = 0;
  const res = response();

  await crearReserva({
    body: {
      ...reservationBody,
      modalidad_servicio: "dia",
      fecha_fin: null,
      fecha_regreso: "2026-07-08",
      hora_regreso: "17:30",
      num_viajes: 1,
    },
  }, res);

  assert.equal(res.statusCode, 201);
  const insert = queries.find(({ query }) => query.startsWith("insert into reservas"));
  const columns = insert.query.match(/insert into reservas \((.*?)\) values/)[1].split(", ");
  assert.equal(insert.params[columns.indexOf("fecha_regreso")], "2026-07-08");
  assert.equal(insert.params[columns.indexOf("hora_regreso")], "17:30");
  assert.equal(insert.params[columns.indexOf("fecha_fin")], null);
});

test("guarda modalidad y duración en horas al crear una cotización", async () => {
  queries.length = 0;
  const res = response();

  await crearCotizacion({
    user: { id: 7, rol: "admin" },
    body: {
      usuario_id: 7,
      origen: "Quito",
      destino: "Baños",
      fecha_servicio: "2026-07-06",
      num_personas: 2,
      num_viajes: 3,
      modalidad_servicio: "horas",
      duracion_horas: 2.5,
      hora_salida: "09:00",
      hora_llegada_estimada: "11:00",
    },
  }, res);

  assert.equal(res.statusCode, 201);
  const insert = queries.find(({ query }) => query.startsWith("insert into cotizaciones"));
  assert.ok(insert);
  assert.match(insert.query, /modalidad_servicio, duracion_horas, itinerario\)/);
  assert.equal(insert.params.at(-3), "horas");
  assert.equal(insert.params.at(-2), 2.5);
  assert.deepEqual(JSON.parse(insert.params.at(-1)), []);
});

test("valida y guarda itinerario continuo al crear una cotización", async () => {
  queries.length = 0;
  const res = response();
  const itinerary = [
    { label: "Quito", lat: -0.18, lng: -78.47, fecha_llegada: "2026-07-07", dias_estadia: 2, hora_salida: "08:00" },
    { label: "Cuenca", lat: -2.9, lng: -79, fecha_llegada: "2026-07-09", dias_estadia: 1, hora_salida: "09:00" },
    { label: "Manta", lat: -0.95, lng: -80.73, fecha_llegada: "2026-07-10", dias_estadia: 0, hora_salida: "", es_retorno: true },
  ];

  await crearCotizacion({
    user: { id: 7, rol: "admin" },
    body: {
      usuario_id: 7, origen: "Manta", destino: "Manta",
      fecha_servicio: "2026-07-06", fecha_fin: "2026-07-10",
      origen_lat: -0.95, origen_lng: -80.73, num_personas: 2, modalidad_servicio: "varios_dias",
      modo_itinerario: true, itinerario: itinerary,
    },
  }, res);

  assert.equal(res.statusCode, 201);
  const insert = queries.find(({ query }) => query.startsWith("insert into cotizaciones"));
  assert.ok(insert);
  assert.deepEqual(JSON.parse(insert.params.at(-1)), itinerary.map(point => ({
    ...point,
    hora_salida: point.hora_salida || null,
    es_retorno: point.es_retorno === true,
  })));

  queries.length = 0;
  const invalidRes = response();
  await crearCotizacion({
    user: { id: 7, rol: "admin" },
    body: {
      usuario_id: 7, origen: "Manta", destino: "Manta",
      fecha_servicio: "2026-07-06", fecha_fin: "2026-07-10",
      num_personas: 2, modalidad_servicio: "varios_dias",
      modo_itinerario: true,
      itinerario: [{ ...itinerary[0], fecha_llegada: "2026-07-09", dias_estadia: 2 }],
    },
  }, invalidRes);

  assert.equal(invalidRes.statusCode, 400);
  assert.equal(queries.some(({ query }) => query.startsWith("insert into cotizaciones")), false);
});

test("guarda varias paradas para un recorrido de un solo día", async () => {
  queries.length = 0;
  const res = response();
  await crearCotizacion({
    user: { id: 7, rol: "admin" },
    body: {
      usuario_id: 7, origen: "Quito", destino: "Otavalo",
      fecha_servicio: "2026-07-06", num_personas: 2, modalidad_servicio: "dia",
      modo_itinerario: true,
      itinerario: [
        { label: "Cayambe", lat: 0.04, lng: -78.15, dias_estadia: 0 },
        { label: "Otavalo", lat: 0.23, lng: -78.26, dias_estadia: 0 },
      ],
    },
  }, res);

  assert.equal(res.statusCode, 201);
  const insert = queries.find(({ query }) => query.startsWith("insert into cotizaciones"));
  assert.ok(insert);
  assert.equal(insert.params[4], null);
  assert.equal(JSON.parse(insert.params.at(-1)).length, 2);

  queries.length = 0;
  const invalidRes = response();
  await crearCotizacion({
    user: { id: 7, rol: "admin" },
    body: {
      usuario_id: 7, origen: "Quito", destino: "Otavalo",
      fecha_servicio: "2026-07-06", num_personas: 2, modalidad_servicio: "dia",
      modo_itinerario: true,
      itinerario: [{ label: "Cayambe", lat: 0.04, lng: -78.15, dias_estadia: 1 }],
    },
  }, invalidRes);

  assert.equal(invalidRes.statusCode, 400);
  assert.equal(queries.some(({ query }) => query.startsWith("insert into cotizaciones")), false);
});

test("edita los detalles operativos usando el parámetro SQL correcto", async () => {
  currentReservation = {
    id: 55,
    usuario_id: 7,
    tour_id: null,
    conductor_id: null,
    vehiculo_id: null,
    fecha_reserva: "2026-07-01",
    fecha_salida: "2026-07-06 09:30:00",
    fecha_llegada: "2026-07-06 14:00:00",
    fecha_servicio: "2026-07-06 09:30:00",
    fecha_fin: null,
    fecha_regreso: null,
    hora_salida: "09:30",
    hora_regreso: null,
    num_personas: 3,
    num_viajes: 1,
    modalidad_servicio: "dia",
    duracion_horas: null,
    duracion_estimada_minutos: null,
    tipo_vehiculo: "van",
    total: 250,
    estado: "pendiente_pago",
    estado_pago: "pendiente",
    estado_operativo: null,
    monto_pagado: 0,
    origen: "Quito",
    destino: "Baños",
    notas: null,
  };
  queries.length = 0;
  const res = response();

  await editarReserva({ params: { id: "55" }, body: reservationBody }, res);

  assert.equal(res.statusCode, 200);
  const update = queries.find(({ query }) => query.startsWith("update reservas set"));
  assert.ok(update);
  const match = update.query.match(/fecha_fin = \$(\d+)/);
  assert.ok(match);
  assert.equal(update.params[Number(match[1]) - 1], "2026-07-08");
  assert.equal(update.params.at(-1), 55);
});
