const test = require("node:test");
const assert = require("node:assert/strict");

const state = {
  reservation: {
    id: 501,
    estado: "confirmada",
    estado_operativo: null,
    estado_pago: "pagado",
    total: 120,
    usuario_id: 51,
  },
  operations: [
    { id: 44, reserva_id: 501, requerimiento_id: 72, grupo_numero: 1, unidad_numero: 1, conductor_id: 14, estado: "asignada", origen: "Quito", destino: "Otavalo" },
    { id: 45, reserva_id: 501, requerimiento_id: 72, grupo_numero: 1, unidad_numero: 2, conductor_id: 14, estado: "asignada", origen: "Quito", destino: "Otavalo" },
  ],
  notifications: [],
  reservationNotifications: [],
  quote: { id: 33, usuario_id: 51, estado: "negociacion", turno: "admin" },
  quoteQueries: [],
};

const result = (rows = []) => ({ rows, rowCount: rows.length });
const normalized = (sql) => sql.replace(/\s+/g, " ").trim().toLowerCase();
const pool = {
  async query(sql) {
    const query = normalized(sql);
    if (query.startsWith("select id from usuarios")) return result([{ id: 7 }]);
    throw new Error(`Unexpected pool query: ${query}`);
  },
  async connect() {
    return {
      async query(sql, params = []) {
        const query = normalized(sql);
        state.quoteQueries.push(query);
        if (["begin", "commit", "rollback"].includes(query)) return result();
        if (query.startsWith("select * from cotizaciones where id = $1 for update")) {
          return result([{ ...state.quote }]);
        }
        if (query.startsWith("select id, estado, estado_operativo from reservas")) {
          return result([{ ...state.reservation }]);
        }
        if (query.startsWith("select id from conductores where usuario_id")) return result([{ id: 14 }]);
        if (query.startsWith("select o.id, o.reserva_id, o.requerimiento_id")) {
          const operation = state.operations.find((row) => row.id === Number(params[0]));
          return result(operation ? [{
            ...operation,
            reserva_estado: state.reservation.estado,
            estado_pago: state.reservation.estado_pago,
            total: state.reservation.total,
            usuario_id: state.reservation.usuario_id,
          }] : []);
        }
        if (query.startsWith("update operaciones set estado = $1")) {
          const operation = state.operations.find((row) => row.id === Number(params[1]));
          if (operation) operation.estado = params[0];
          return result();
        }
        if (query.startsWith("insert into operacion_historial")) return result();
        if (query.startsWith("select count(*)::int as total")) {
          return result([{
            total: state.operations.length,
            completadas: state.operations.filter((row) => row.estado === "completada").length,
          }]);
        }
        if (query.startsWith("update reservas set estado_operativo")) {
          state.reservation.estado_operativo = "en_curso";
          return result();
        }
        if (query.startsWith("update reservas set estado = 'finalizada'")) {
          state.reservation.estado = "finalizada";
          state.reservation.estado_operativo = "finalizada";
          return result();
        }
        if (query.startsWith("update requerimientos_personalizados set estado")) return result();
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
  async crearNotificacion(...args) { state.notifications.push(args); },
  async notificarAdmins() {},
});
installMock("../dist/config/reservaMailer", {
  async notificarClienteReserva(...args) { state.reservationNotifications.push(args); },
});

const { actualizarEstadoOperacionConductor } = require("../dist/controllers/conductor.controller");
const { cancelarMiReserva } = require("../dist/controllers/usuarios.controller");
const { responderCotizacion } = require("../dist/controllers/admin/cotizaciones.admin.controller");

const response = () => ({
  statusCode: 200,
  body: null,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});

test("bloquea la cancelación del cliente cuando alguna operación ya está en curso", async () => {
  state.reservation.estado_operativo = "en_curso";
  const res = response();
  await cancelarMiReserva({ user: { id: 51 }, params: { id: "501" }, body: {} }, res);

  assert.equal(res.statusCode, 409);
  assert.match(res.body.error, /ya está en curso/i);
  state.reservation.estado_operativo = null;
});

test("rechaza respuestas a cotizaciones cuando el turno pertenece a Administración", async () => {
  state.quoteQueries = [];
  const res = response();
  await responderCotizacion({
    params: { id: "33" },
    body: { accion: "aceptar" },
    user: { id: 51 },
  }, res);

  assert.equal(res.statusCode, 409);
  assert.match(res.body.error, /propuesta pendiente/i);
  assert.ok(state.quoteQueries.some((query) => query.includes("for update")));
  assert.equal(state.quoteQueries.some((query) => query.startsWith("update cotizaciones")), false);
});

test("el conductor solo actualiza sus operaciones y finaliza el servicio al completar todas las unidades", async () => {
  const reqFor = (operationId, estado) => ({
    params: { id: "7", operationId: String(operationId) },
    body: { estado },
  });
  const unauthorized = response();
  state.operations[0].conductor_id = 99;
  await actualizarEstadoOperacionConductor(reqFor(44, "en_curso"), unauthorized);
  assert.equal(unauthorized.statusCode, 403);
  state.operations[0].conductor_id = 14;

  const started = response();
  await actualizarEstadoOperacionConductor(reqFor(44, "en_curso"), started);
  assert.equal(started.statusCode, 200);
  assert.equal(state.reservation.estado_operativo, "en_curso");
  assert.equal(state.notifications.length, 1);

  const firstCompleted = response();
  await actualizarEstadoOperacionConductor(reqFor(44, "completada"), firstCompleted);
  assert.equal(firstCompleted.statusCode, 200);
  assert.equal(firstCompleted.body.servicio_finalizado, false);
  assert.equal(state.reservation.estado, "confirmada");
  assert.equal(state.reservationNotifications.length, 0);

  state.operations[1].estado = "en_curso";
  const finalCompleted = response();
  await actualizarEstadoOperacionConductor(reqFor(45, "completada"), finalCompleted);
  assert.equal(finalCompleted.statusCode, 200);
  assert.equal(finalCompleted.body.servicio_finalizado, true);
  assert.equal(state.reservation.estado, "finalizada");
  assert.equal(state.reservation.estado_operativo, "finalizada");
  assert.deepEqual(state.reservationNotifications, [[501, "finalizada", 7]]);
});
