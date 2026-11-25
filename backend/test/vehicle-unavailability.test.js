const test = require("node:test");
const assert = require("node:assert/strict");

const state = { listRows: [] };
const result = (rows = []) => ({ rows, rowCount: rows.length });
const normalized = (sql) => sql.replace(/\s+/g, " ").trim().toLowerCase();

const pool = {
  async query(sql, params = []) {
    const query = normalized(sql);
    if (query.startsWith("select id as vehiculo_id from vehiculos")) {
      assert.equal(params[0], 301);
      return result([{ vehiculo_id: 701 }]);
    }
    if (query.startsWith("select b.id, b.vehiculo_id, b.tipo, b.urgente")) {
      assert.match(query, /b\.fecha_inicio::text as fecha_inicio/);
      assert.match(query, /b\.fecha_fin::text as fecha_fin/);
      assert.deepEqual(params[0], [701]);
      return result(state.listRows);
    }
    throw new Error(`Unexpected pool query: ${query}`);
  },
};

const installMock = (specifier, exports) => {
  const id = require.resolve(specifier);
  require.cache[id] = { id, filename: id, loaded: true, exports, children: [], paths: [] };
};

installMock("../dist/config/db", pool);
installMock("../dist/config/notificaciones", {
  async crearNotificacion() {},
});

const { listDriverVehicleUnavailability } = require("../dist/controllers/vehiculo-indisponibilidades.controller");

const response = () => ({
  statusCode: 200,
  body: null,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});

test("devuelve fechas de indisponibilidad en formato de fecha sin conversión de zona horaria", async () => {
  state.listRows = [{
    id: 31, vehiculo_id: 701, fecha_inicio: "2098-11-16", fecha_fin: "2098-11-16",
  }];
  const res = response();

  await listDriverVehicleUnavailability({ params: { id: "301" } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body[0].fecha_inicio, "2098-11-16");
  assert.equal(res.body[0].fecha_fin, "2098-11-16");
});
