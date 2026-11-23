const test = require("node:test");
const assert = require("node:assert/strict");

const insertedOperations = [];
const groups = [
  {
    cantidad_vehiculos: 2,
    tipo_vehiculo: "Bus",
    pasajeros_por_vehiculo: 40,
    fecha_servicio: "2026-11-10",
    fecha_fin: "2026-11-11",
    hora_salida: "08:30",
    origen: "Manta",
    destino: "Quito",
  },
  {
    cantidad_vehiculos: 1,
    tipo_vehiculo: "SUV",
    pasajeros_por_vehiculo: 4,
    fecha_servicio: "2026-11-12",
    fecha_fin: "2026-11-12",
    hora_salida: "09:00",
    origen: "Manta",
    destino: "Montecristi",
  },
];
let dispatchStatus = "pendiente";
let requestGroups = groups;

const client = {
  async query(sql, params = []) {
    const query = sql.replace(/\s+/g, " ").trim().toLowerCase();
    if (["begin", "commit", "rollback"].includes(query)) return { rows: [], rowCount: 0 };
    if (query.startsWith("select r.id, r.service_groups")) {
      return {
        rows: [{
          id: 44,
          service_groups: requestGroups,
          estado_despacho: dispatchStatus,
          estado_reserva: "confirmada",
          estado_pago: "pagado",
        }],
        rowCount: 1,
      };
    }
    if (query.startsWith("select count(*)::int as total")) {
      return { rows: [{ total: insertedOperations.length }], rowCount: 1 };
    }
    if (query.startsWith("insert into operaciones")) {
      insertedOperations.push(params);
      return { rows: [{ id: insertedOperations.length }], rowCount: 1 };
    }
    if (query.startsWith("insert into operacion_historial")) return { rows: [], rowCount: 1 };
    if (query.startsWith("update requerimientos_personalizados")) {
      dispatchStatus = query.includes("estado_despacho = 'generado'") ? "generado" : dispatchStatus;
      return { rows: [], rowCount: 1 };
    }
    throw new Error(`Unexpected dispatch query: ${query}`);
  },
  release() {},
};

const dbModule = require.resolve("../dist/config/db");
require.cache[dbModule] = {
  id: dbModule,
  filename: dbModule,
  loaded: true,
  exports: {
    async connect() { return client; },
    async query() { return { rows: [], rowCount: 0 }; },
  },
  children: [],
  paths: [],
};

const { prepararDespachoRequerimiento } = require("../dist/config/requerimientosDespacho");

test("crea una operación por unidad y repite sin duplicar operaciones", async () => {
  const first = await prepararDespachoRequerimiento(900, 2);
  assert.deepEqual(first, { found: true, created: 3, total: 3 });
  assert.equal(insertedOperations.length, 3);
  assert.deepEqual(insertedOperations.map(params => [params[2], params[3]]), [[1, 1], [1, 2], [2, 1]]);
  assert.equal(dispatchStatus, "generado");

  const second = await prepararDespachoRequerimiento(900, 2);
  assert.deepEqual(second, { found: true, created: 0, total: 3 });
  assert.equal(insertedOperations.length, 3);
});

test("despacha solo grupos incluidos y conserva el número original del grupo", async () => {
  insertedOperations.length = 0;
  dispatchStatus = "pendiente";
  requestGroups = [
    { ...groups[0], incluido_en_propuesta: false },
    { ...groups[1], incluido_en_propuesta: true },
  ];

  const result = await prepararDespachoRequerimiento(900, 2);

  assert.deepEqual(result, { found: true, created: 1, total: 1 });
  assert.equal(insertedOperations.length, 1);
  assert.equal(insertedOperations[0][2], 2);
  assert.equal(insertedOperations[0][3], 1);
});

test("rechaza datos de grupo insuficientes para despacho", async () => {
  dispatchStatus = "pendiente";
  insertedOperations.length = 0;
  requestGroups = [{ ...groups[0], fecha_servicio: "" }];
  await assert.rejects(() => prepararDespachoRequerimiento(900, 2), /grupo 1 no tiene fecha/);
  assert.equal(insertedOperations.length, 0);
});
