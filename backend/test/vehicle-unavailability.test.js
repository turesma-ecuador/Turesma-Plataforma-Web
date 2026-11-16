const test = require("node:test");
const assert = require("node:assert/strict");

const state = { notifications: [], sql: [], inserted: null };
const result = (rows = []) => ({ rows, rowCount: rows.length });
const normalized = (sql) => sql.replace(/\s+/g, " ").trim().toLowerCase();

const pool = {
  async query(sql) {
    const query = normalized(sql);
    state.sql.push(query);
    throw new Error(`Unexpected pool query: ${query}`);
  },
  async connect() {
    return {
      async query(sql, params = []) {
        const query = normalized(sql);
        state.sql.push(query);
        if (["begin", "commit", "rollback"].includes(query)) return result();
        if (query.startsWith("select id as vehiculo_id from vehiculos")) return result([{ vehiculo_id: 701 }]);
        if (query.startsWith("select id, placa from vehiculos where id = $1 for update")) {
          return result([{ id: 701, placa: "TEST-701" }]);
        }
        if (query.startsWith("select id from vehiculo_indisponibilidades")) return result();
        if (query.startsWith("select o.id, o.reserva_id")) {
          return result([{
            id: 901, reserva_id: 801, fecha_inicio: "2026-10-21",
            fecha_fin: "2026-10-21", placa: "TEST-701",
          }]);
        }
        if (query.startsWith("select r.id as reserva_id")) return result();
        if (query.startsWith("insert into vehiculo_indisponibilidades")) {
          assert.equal(params[0], 701);
          assert.equal(params[1], "correctivo");
          assert.equal(params[2], true);
          assert.equal(params[4], null);
          assert.equal(params[8], 301);
          state.inserted = {
            id: 31, vehiculo_id: params[0], tipo: params[1], urgente: params[2],
            fecha_inicio: params[3], fecha_fin: params[4], motivo: params[7], estado: "activa",
          };
          return result([state.inserted]);
        }
        throw new Error(`Unexpected transaction query: ${query}`);
      },
      release() {},
    };
  },
};

const installMock = (specifier, exports) => {
  const id = require.resolve(specifier);
  require.cache[id] = { id, filename: id, loaded: true, exports, children: [], paths: [] };
};

installMock("../dist/config/db", pool);
installMock("../dist/config/notificaciones", {
  async notificarAdmins(...args) { state.notifications.push(args); },
  async crearNotificacion() {},
});

const { createDriverVehicleUnavailability } = require("../dist/controllers/vehiculo-indisponibilidades.controller");

const response = () => ({
  statusCode: 200,
  body: null,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});

test("registra urgencias correctivas sin fecha final y reporta viajes existentes", async () => {
  state.notifications.length = 0;
  state.sql.length = 0;
  state.inserted = null;
  const res = response();

  await createDriverVehicleUnavailability({
    params: { id: "301" },
    body: { vehiculo_id: 701, tipo: "correctivo", urgente: true, motivo: "Falla mecánica" },
  }, res);

  assert.equal(res.statusCode, 201);
  assert.equal(res.body.indisponibilidad.urgente, true);
  assert.equal(res.body.indisponibilidad.fecha_fin, null);
  assert.equal(res.body.conflictos.length, 1);
  assert.match(res.body.message, /servicios existentes que requieren coordinación/i);
  assert.equal(state.sql.includes("commit"), true);
  assert.equal(state.notifications.length, 1);
  assert.match(state.notifications[0][1], /servicio\(s\) ya asignado\(s\)/i);
});

test("rechaza una urgencia preventiva antes de abrir la base de datos", async () => {
  state.sql.length = 0;
  const res = response();

  await createDriverVehicleUnavailability({
    params: { id: "301" },
    body: { vehiculo_id: 701, tipo: "preventivo", urgente: true, motivo: "Servicio" },
  }, res);

  assert.equal(res.statusCode, 400);
  assert.equal(state.sql.length, 0);
});
