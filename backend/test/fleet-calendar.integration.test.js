const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const jwt = require("jsonwebtoken");

process.env.JWT_SECRET = "fleet-calendar-integration-test-secret";

const queryResults = [
  { match: "select session_version from usuarios", rows: [{ session_version: 0 }] },
  {
    match: "from vehiculos where activo = true",
    rows: [{ id: 21, placa: "TEST-021", tipo: "van", modelo: "Van de prueba", estado: "disponible" }],
  },
  {
    match: "from operaciones o where o.fecha_programada",
    rows: [{
      id: 31,
      vehiculo_id: 21,
      fecha_inicio: "2026-10-12",
      fecha_fin: "2026-10-12",
      estado: "asignada",
      tipo_servicio: "viaje",
      origen: "Manta",
      destino: "Quito",
    }],
  },
  {
    match: "from disponibilidad_externa d",
    rows: [{
      id: 71,
      vehiculo_id: 21,
      fecha_inicio: "2026-10-17",
      fecha_fin: "2026-10-17",
      estado: "activo",
      tipo_servicio: "viaje_externo",
      hora_inicio: "08:00:00",
      hora_fin: "12:00:00",
      conductor_nombre: "Chofer externo",
    }],
  },
  {
    match: "left join lateral",
    rows: [{
      id: 61,
      fecha_reserva: "2026-10-16",
      origen: "Manta",
      destino: "Jipijapa",
      tipo_vehiculo: "SUV",
      num_personas: 4,
      cliente_nombre: "Cliente de prueba",
    }],
  },
  {
    match: "from reservas r where r.vehiculo_id",
    rows: [{
      id: 41,
      vehiculo_id: 21,
      fecha_inicio: "2026-10-13",
      fecha_fin: "2026-10-14",
      estado: "confirmada",
      tipo_vehiculo: "van",
      origen: "Manta",
      destino: "Portoviejo",
    }],
  },
  {
    match: "from mantenimiento_vehiculos m where m.fecha_programada",
    rows: [{
      id: 51,
      vehiculo_id: 21,
      fecha_inicio: "2026-10-15",
      fecha_fin: "2026-10-15",
      estado: "programado",
      tipo_servicio: "Preventivo",
    }],
  },
];

const pool = {
  async query(sql) {
    const query = sql.replace(/\s+/g, " ").trim().toLowerCase();
    const result = queryResults.find((entry) => query.includes(entry.match));
    if (!result) throw new Error(`Unexpected fleet calendar query: ${query}`);
    return { rows: result.rows };
  },
};

const databaseModule = require.resolve("../dist/config/db");
require.cache[databaseModule] = {
  id: databaseModule,
  filename: databaseModule,
  loaded: true,
  exports: pool,
  children: [],
  paths: [],
};

const adminRoutes = require("../dist/routes/admin.routes");
const app = express();
app.use(express.json());
app.use("/api/admin", adminRoutes);

let server;
let baseUrl;
const tokenForRole = (rol) => jwt.sign({
  id: 99,
  email: `${rol}@example.invalid`,
  rol,
  session_id: "00000000-0000-4000-8000-000000000001",
}, process.env.JWT_SECRET);

test("el calendario de flota solo permite acceso administrativo y devuelve ocupación", async (t) => {
  await new Promise((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  t.after(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));

  const request = async (query, token) => {
    const response = await fetch(`${baseUrl}/api/admin/calendario-flota${query}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    return { status: response.status, body: await response.json() };
  };

  await t.test("rechaza solicitudes sin token", async () => {
    const response = await request("?desde=2026-10-01&hasta=2026-10-31");
    assert.equal(response.status, 401);
  });

  await t.test("rechaza roles operativos y de cliente", async () => {
    const operativo = await request("?desde=2026-10-01&hasta=2026-10-31", tokenForRole("operativo"));
    const cliente = await request("?desde=2026-10-01&hasta=2026-10-31", tokenForRole("cliente"));
    assert.equal(operativo.status, 403);
    assert.equal(cliente.status, 403);
  });

  await t.test("valida el rango solicitado", async () => {
    const invalid = await request("?desde=2026-02-30&hasta=2026-03-01", tokenForRole("admin"));
    const tooLong = await request("?desde=2026-01-01&hasta=2026-03-10", tokenForRole("admin"));
    assert.equal(invalid.status, 400);
    assert.equal(tooLong.status, 400);
  });

  await t.test("entrega los vehículos, sus eventos y reservas por subcontratar", async () => {
    const response = await request("?desde=2026-10-01&hasta=2026-10-31", tokenForRole("admin"));
    assert.equal(response.status, 200);
    assert.equal(response.body.vehicles[0].placa, "TEST-021");
    assert.deepEqual(response.body.events.map((event) => event.tipo), ["operacion", "reserva", "mantenimiento", "externo"]);
    assert.equal(response.body.unassignedReservations[0].id, 61);
  });
});
