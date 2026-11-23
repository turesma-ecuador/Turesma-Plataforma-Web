const test = require("node:test");
const assert = require("node:assert/strict");

const reservation = {
  id: 91,
  origen: "Quito",
  destino: "Manta",
  fecha_servicio: "2026-11-11",
  hora_salida: "08:30",
  fecha_regreso: "2026-11-15",
  hora_regreso: "10:00",
  num_personas: 6,
  notas: "Viaje familiar",
  tipo_vehiculo: "van",
  precio: "420.00",
  cliente_nombre: "Cliente de prueba",
  cliente_email: "cliente@example.invalid",
  cliente_telefono: "0990000000",
  cliente_cedula: "1234567890",
};
const customRequest = {
  id: 44,
  organizacion: "Empresa de prueba",
  detalles: "Traslado de personal en dos rutas",
  service_groups: [
    { cantidad_vehiculos: 2, tipo_vehiculo: "Bus", pasajeros_por_vehiculo: 40, fecha_servicio: "2026-11-11", origen: "Quito", destino: "Manta", precio_total: 1100 },
    { cantidad_vehiculos: 1, tipo_vehiculo: "SUV", pasajeros_por_vehiculo: 4, fecha_servicio: "2026-11-12", origen: "Manta", destino: "Montecristi", precio_total: 450 },
  ],
  precio_final: "1550.00",
  estado: "propuesta_enviada",
  cliente_nombre: "Cliente de prueba",
  cliente_email: "cliente@example.invalid",
  cliente_telefono: "0990000000",
  cliente_cedula: "1234567890",
};
let reservationRequestId = null;

const pool = {
  async query(sql, params) {
    const query = sql.replace(/\s+/g, " ").trim().toLowerCase();
    if (query.startsWith("select r.id, rp.id as requerimiento_id")) {
      return params[1] === 7
        ? { rows: [{ ...reservation, requerimiento_id: reservationRequestId }], rowCount: 1 }
        : { rows: [], rowCount: 0 };
    }
    if (query.startsWith("select id from cotizaciones where reserva_id")) {
      return { rows: [], rowCount: 0 };
    }
    if (query.startsWith("select r.id, r.organizacion")) {
      return params[0] === 44 && (params.length === 1 || params[1] === 7)
        ? { rows: [{ ...customRequest }], rowCount: 1 }
        : { rows: [], rowCount: 0 };
    }
    throw new Error(`Unexpected proforma query: ${query}`);
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

const { buildProformaDataDeReserva, buildProformaDataRequerimiento, generarProformaPDF } = require("../dist/config/proforma");

test("genera proforma para reserva propia sin cotización vinculada", async () => {
  const data = await buildProformaDataDeReserva(91, 7);
  assert.equal(data.numero, "RES-91");
  assert.equal(data.precio, 420);
  assert.equal(data.servicio.tipo_vehiculo, "van");
  assert.equal(data.servicio.fecha_regreso, "2026-11-15");

  const pdf = await generarProformaPDF(data);
  assert.ok(Buffer.isBuffer(pdf));
  assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
  assert.ok(pdf.length > 1000);
});

test("no expone la proforma de una reserva que pertenece a otro usuario", async () => {
  const data = await buildProformaDataDeReserva(91, 8);
  assert.equal(data, null);
});

test("genera una proforma multigrupo con subtotales por grupo y protege la propiedad", async () => {
  const data = await buildProformaDataRequerimiento(44, 7);
  assert.equal(data.precio, 1550);
  assert.equal(data.proformaItems.length, 2);
  assert.match(data.proformaItems[0].descripcion, /Desde: Quito \/ Hasta: Manta/);
  assert.equal(data.proformaItems[0].precio_unitario, 550);
  assert.equal(data.proformaItems[1].total, 450);
  assert.equal(await buildProformaDataRequerimiento(44, 8), null);

  const pdf = await generarProformaPDF(data);
  assert.ok(Buffer.isBuffer(pdf));
  assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
  assert.ok(pdf.length > 1000);

  reservationRequestId = 44;
  const reservationProforma = await buildProformaDataDeReserva(91, 7);
  assert.equal(reservationProforma.numero, "REQ-44");
  assert.equal(reservationProforma.proformaItems.length, 2);
  reservationRequestId = null;
});
