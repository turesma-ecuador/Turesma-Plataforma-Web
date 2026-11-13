const test = require("node:test");
const assert = require("node:assert/strict");

const reservation = {
  id: 91,
  usuario_id: 7,
  estado_pago: "pagado",
  monto_pagado: "420.00",
  fecha_servicio: "2026-11-11",
  hora_salida: "08:30",
  fecha_regreso: "2026-11-15",
  hora_regreso: "10:00",
  num_personas: 6,
  notas: "Viaje familiar",
  tipo_vehiculo: "van",
  origen: "Quito",
  destino: "Manta",
  total: "420.00",
  cliente_nombre: "Cliente de prueba",
  cliente_email: "cliente@example.invalid",
  cliente_telefono: "0990000000",
  cliente_identificacion: "1234567890",
  cliente_tipo_identificacion: "cedula",
};

const pool = {
  async query(sql, params) {
    const query = sql.replace(/\s+/g, " ").trim().toLowerCase();
    if (query.startsWith("select r.id, r.usuario_id")) {
      return params[0] === 91 && params[1] === 7
        ? { rows: [{ ...reservation }], rowCount: 1 }
        : { rows: [], rowCount: 0 };
    }
    if (query.startsWith("select max(coalesce(revisado_en, creado_en))")) {
      return {
        rows: [{ fecha_pago: "2026-11-10T12:00:00.000Z", metodo_pago: "transferencia" }],
        rowCount: 1,
      };
    }
    throw new Error(`Unexpected purchase order query: ${query}`);
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

const { buildOrdenCompraDataDeReserva, generarOrdenCompraPDF } = require("../dist/config/ordenCompra");

test("genera una orden de compra con el total y los pagos aprobados", async () => {
  const data = await buildOrdenCompraDataDeReserva(91, 7);
  assert.equal(data.numero, "OC-RES-000091");
  assert.equal(data.total, 420);
  assert.equal(data.monto_pagado, 420);
  assert.equal(data.metodo_pago, "transferencia");
  assert.equal(data.cliente.nombre, "Cliente de prueba");
  assert.equal(data.servicio.origen, "Quito");

  const pdf = await generarOrdenCompraPDF(data);
  assert.ok(Buffer.isBuffer(pdf));
  assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
  assert.ok(pdf.length > 1000);
});

test("no genera una orden de compra para una reserva de otro usuario", async () => {
  assert.equal(await buildOrdenCompraDataDeReserva(91, 8), null);
});
