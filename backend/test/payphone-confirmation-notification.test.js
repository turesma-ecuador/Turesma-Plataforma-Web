const test = require("node:test");
const assert = require("node:assert/strict");

const notifications = [];
const state = {
  reservation: { id: 501, usuario_id: 51, estado: "pendiente_pago", total: 100, monto_pagado: 50 },
  payment: null,
};
const result = (rows = []) => ({ rows, rowCount: rows.length });
const normalized = (sql) => sql.replace(/\s+/g, " ").trim().toLowerCase();

const pool = {
  async query(sql) {
    const query = normalized(sql);
    if (query.startsWith("select id from usuarios where rol = 'admin'")) return result([{ id: 99 }]);
    if (query.startsWith("update reservas set estado = 'confirmada'")) return result();
    throw new Error(`Unexpected pool query: ${query}`);
  },
  async connect() {
    return {
      async query(sql, params = []) {
        const query = normalized(sql);
        if (["begin", "commit", "rollback"].includes(query)) return result();
        if (query.startsWith("select id, usuario_id, estado, total, coalesce(monto_pagado")) {
          return result([{ ...state.reservation }]);
        }
        if (query.startsWith("select id from pagos_reserva where metodo = 'payphone'")) return result();
        if (query.startsWith("insert into pagos_reserva")) {
          state.payment = { id: 601, monto: Number(params[2]), estado: "aprobado" };
          return result([state.payment]);
        }
        if (query.startsWith("select coalesce((select sum(monto) from pagos_reserva")) {
          return result([{ total: 75 }]);
        }
        if (query.startsWith("update reservas set monto_pagado = $1")) {
          state.reservation.monto_pagado = Number(params[0]);
          state.reservation.estado_pago = params[1];
          return result();
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
  async crearNotificacion(...args) { notifications.push(args); },
  async notificarAdmins() {},
});
installMock("../dist/config/reservaMailer", { async notificarClienteReserva() {} });
installMock("../dist/config/payphone", {
  async confirmPayphonePayment() { return { status: "approved", amount: 5000 }; },
});
installMock("../dist/config/requerimientosDespacho", { async prepararDespachoRequerimiento() { return null; } });
installMock("../dist/controllers/cambios-destino.controller", { async aplicarCambioDestinoTrasPago() {} });

const { confirmarPagoPayphone } = require("../dist/controllers/pagos.controller");

test("avisa al cliente cuando PayPhone confirma un pago parcial", async () => {
  const res = {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  await confirmarPagoPayphone({
    user: { id: 51 },
    params: { id: "501" },
    body: {
      payment_id: "payphone-1",
      client_transaction_id: "turesma-reserva-501-123",
    },
  }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.estado_pago, "parcial");
  assert.equal(state.reservation.monto_pagado, 75);
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0][0], 99);
  assert.equal(notifications[0][1], 51);
  assert.match(notifications[0][2], /pago PayPhone de \$50\.00/);
});
