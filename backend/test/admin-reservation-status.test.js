const assert = require("node:assert/strict");
const test = require("node:test");

const queries = [];
let currentReservation = {
  id: 12,
  usuario_id: 7,
  total: 250,
  estado: "pendiente",
  estado_pago: "pagado",
  estado_operativo: null,
  recogido: false,
};

const client = {
  async query(sql, params = []) {
    const query = sql.replace(/\s+/g, " ").trim().toLowerCase();
    queries.push({ query, params });
    if (["begin", "commit", "rollback"].includes(query)) return { rows: [], rowCount: 0 };
    if (query.startsWith("select id, usuario_id, total, estado, estado_pago")) {
      return { rows: [{ ...currentReservation }], rowCount: 1 };
    }
    if (query.startsWith("update reservas set estado = $1")) {
      currentReservation = { ...currentReservation, estado: params[0] };
      if (params[2]) currentReservation.estado_operativo = "cancelada";
      return {
        rows: [{
          id: currentReservation.id,
          estado: currentReservation.estado,
          estado_operativo: currentReservation.estado_operativo,
        }],
        rowCount: 1,
      };
    }
    if (query.startsWith("insert into reserva_historial")) return { rows: [], rowCount: 1 };
    throw new Error(`Unexpected client query: ${query}`);
  },
  release() {},
};

const pool = {
  async connect() { return client; },
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

const { actualizarEstadoViaje } = require("../dist/controllers/admin/catalogo-reservas.admin.controller");

const response = () => ({
  statusCode: 200,
  body: null,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});

test("confirma una reserva pagada sin mezclar los tipos del parámetro SQL del estado", async () => {
  currentReservation = {
    id: 12,
    usuario_id: 7,
    total: 250,
    estado: "pendiente",
    estado_pago: "pagado",
    estado_operativo: null,
    recogido: false,
  };
  queries.length = 0;
  const res = response();

  await actualizarEstadoViaje({
    params: { id: "12" },
    body: { estado: "confirmada" },
    user: { id: 2 },
  }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(currentReservation.estado, "confirmada");
  const update = queries.find(item => item.query.startsWith("update reservas set estado = $1"));
  assert.ok(update);
  assert.match(update.query, /case when \$3::boolean/);
  assert.deepEqual(update.params, ["confirmada", 12, false]);
});
