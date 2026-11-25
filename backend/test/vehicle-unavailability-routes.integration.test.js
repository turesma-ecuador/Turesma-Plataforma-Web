const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const jwt = require("jsonwebtoken");

process.env.JWT_SECRET = "vehicle-unavailability-routes-test-secret";

const state = {
  accounts: new Set([101, 102, 103, 301, 302]),
  vehicles: [
    { id: 701, placa: "TEST-701", usuario_id: 301 },
    { id: 702, placa: "TEST-702", usuario_id: 302 },
  ],
  driverVehicles: new Map([[301, [701]], [302, [702]]]),
  vehicleDrivers: new Map([[701, 301], [702, 302]]),
  blocks: [],
  operations: [],
  reservations: [],
  notifications: [],
  nextBlockId: 1,
  connectCalls: 0,
};

const result = (rows = []) => ({ rows, rowCount: rows.length });
const normalized = (sql) => sql.replace(/\s+/g, " ").trim().toLowerCase();
const overlapsDates = (startA, endA, startB, endB) => startA <= endB && endA >= startB;
const overlapsTimes = (startA, endA, startB, endB) => startA < endB && startB < endA;

const overlapsBlock = (block, vehicleId, startDate, endDate, startTime, endTime) => {
  if (block.vehiculo_id !== vehicleId || block.estado !== "activa") return false;
  const blockEnd = block.fecha_fin || "9999-12-31";
  if (!overlapsDates(block.fecha_inicio, blockEnd, startDate, endDate)) return false;
  if (startDate !== endDate || !startTime || !endTime || !block.hora_inicio || !block.hora_fin) return true;
  return overlapsTimes(block.hora_inicio, block.hora_fin, startTime, endTime);
};

const overlapsTrip = (trip, vehicleId, startDate, endDate, startTime, endTime) => {
  if (trip.vehiculo_id !== vehicleId) return false;
  if (!overlapsDates(trip.fecha_inicio, trip.fecha_fin || trip.fecha_inicio, startDate, endDate)) return false;
  if (startDate !== endDate || !startTime || !endTime || !trip.hora_inicio || !trip.hora_fin) return true;
  return overlapsTimes(trip.hora_inicio, trip.hora_fin, startTime, endTime);
};

const handleQuery = async (sql, params = []) => {
  const query = normalized(sql);

  if (query.startsWith("select session_version from usuarios")) {
    return result(state.accounts.has(Number(params[0])) ? [{ session_version: 0 }] : []);
  }
  if (query.startsWith("select id as vehiculo_id from vehiculos")) {
    return result((state.driverVehicles.get(Number(params[0])) || []).map((id) => ({ vehiculo_id: id })));
  }
  if (query.startsWith("select coalesce(v.usuario_id, c.usuario_id) as usuario_id")) {
    const userId = state.vehicleDrivers.get(Number(params[0]));
    return result(userId ? [{ usuario_id: userId }] : []);
  }
  if (query.startsWith("select b.id, b.vehiculo_id, b.tipo, b.urgente")) {
    return result(state.blocks);
  }
  if (query.startsWith("update vehiculo_indisponibilidades")) {
    const [id, userId] = params;
    const block = state.blocks.find((entry) => entry.id === Number(id) && entry.estado === "activa");
    if (!block) return result();
    block.estado = "cerrada";
    block.cerrado_por = Number(userId);
    block.cerrado_en = "2026-11-16T12:00:00.000Z";
    return result([{ vehiculo_id: block.vehiculo_id }]);
  }

  throw new Error(`Unexpected pool query: ${query}`);
};

const pool = {
  query: handleQuery,
  async connect() {
    state.connectCalls++;
    return {
      query: async (sql, params = []) => {
        const query = normalized(sql);
        if (["begin", "commit", "rollback"].includes(query)) return result();
        if (query.startsWith("select id as vehiculo_id from vehiculos")) {
          return result((state.driverVehicles.get(Number(params[0])) || []).map((id) => ({ vehiculo_id: id })));
        }
        if (query.startsWith("select id, placa from vehiculos where id = $1 for update")) {
          const vehicle = state.vehicles.find((entry) => entry.id === Number(params[0]));
          return result(vehicle ? [vehicle] : []);
        }
        if (query.startsWith("select id from vehiculo_indisponibilidades b")) {
          const [vehicleId, startDate, endDate, startTime, endTime] = params;
          const block = state.blocks.find((entry) => overlapsBlock(
            entry, Number(vehicleId), String(startDate), String(endDate), startTime, endTime
          ));
          return result(block ? [{ id: block.id }] : []);
        }
        if (query.startsWith("select o.id, o.reserva_id")) {
          const [vehicleId, startDate, endDate, startTime, endTime] = params;
          return result(state.operations
            .filter((trip) => ["programada", "asignada", "en_curso", "incidencia"].includes(trip.estado)
              && overlapsTrip(trip, Number(vehicleId), String(startDate), String(endDate), startTime, endTime))
            .map((trip) => ({
              id: trip.id,
              reserva_id: trip.reserva_id,
              fecha_inicio: trip.fecha_inicio,
              fecha_fin: trip.fecha_fin || trip.fecha_inicio,
              estado: trip.estado,
              tipo_servicio: trip.tipo_servicio || "reserva",
              placa: state.vehicles.find((vehicle) => vehicle.id === trip.vehiculo_id)?.placa,
            })));
        }
        if (query.startsWith("select r.id as reserva_id")) {
          const [vehicleId, startDate, endDate, startTime, endTime] = params;
          return result(state.reservations
            .filter((trip) => !["cancelada", "finalizada"].includes(trip.estado)
              && !state.operations.some((operation) => operation.reserva_id === trip.id
                && ["programada", "asignada", "en_curso", "incidencia"].includes(operation.estado))
              && overlapsTrip(trip, Number(vehicleId), String(startDate), String(endDate), startTime, endTime))
            .map((trip) => ({
              reserva_id: trip.id,
              estado: trip.estado,
              fecha_inicio: trip.fecha_inicio,
              fecha_fin: trip.fecha_fin || trip.fecha_inicio,
              placa: state.vehicles.find((vehicle) => vehicle.id === trip.vehiculo_id)?.placa,
            })));
        }
        if (query.startsWith("insert into vehiculo_indisponibilidades")) {
          const [vehicleId, tipo, urgente, startDate, endDate, startTime, endTime, motivo, creatorId] = params;
          const block = {
            id: state.nextBlockId++,
            vehiculo_id: Number(vehicleId),
            tipo,
            urgente,
            fecha_inicio: String(startDate),
            fecha_fin: endDate,
            hora_inicio: startTime,
            hora_fin: endTime,
            motivo,
            estado: "activa",
            creado_por: Number(creatorId),
            rol_creador: query.includes("'admin'") ? "admin" : "conductor",
            creado_en: "2026-11-16T12:00:00.000Z",
          };
          state.blocks.push(block);
          return result([block]);
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
  async notificarAdmins(...args) { state.notifications.push({ type: "admin", args }); },
  async crearNotificacion(...args) { state.notifications.push({ type: "user", args }); },
});

const adminRoutes = require("../dist/routes/admin.routes");
const conductorRoutes = require("../dist/routes/conductor.routes");
const app = express();
app.use(express.json());
app.use("/api/admin", adminRoutes);
app.use("/api/conductor", conductorRoutes);

const tokenFor = (id, rol) => jwt.sign({
  id,
  email: `${id}@example.invalid`,
  rol,
  session_version: 0,
  session_id: `00000000-0000-4000-8000-${String(id).padStart(12, "0")}`,
}, process.env.JWT_SECRET);

const tokens = {
  admin: tokenFor(101, "admin"),
  operativo: tokenFor(102, "operativo"),
  client: tokenFor(103, "cliente"),
  driver: tokenFor(301, "vehiculo"),
  otherDriver: tokenFor(302, "vehiculo"),
};

const resetState = () => {
  state.blocks.length = 0;
  state.operations.length = 0;
  state.reservations.length = 0;
  state.notifications.length = 0;
  state.nextBlockId = 1;
  state.connectCalls = 0;
};

test("mantenimiento: permisos y gestión administrativa de bloqueos", async (t) => {
  resetState();
  let server;
  await new Promise((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  t.after(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));

  const request = async (path, { method = "GET", token, body } = {}) => {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const text = await response.text();
    let responseBody;
    try { responseBody = text ? JSON.parse(text) : null; } catch { responseBody = null; }
    return { status: response.status, body: responseBody };
  };

  const driverPath = (id = 301) => `/api/conductor/${id}/indisponibilidades-mantenimiento`;
  const adminPath = "/api/admin/mantenimiento/indisponibilidades";
  const validPlannedBlock = (overrides = {}) => ({
    vehiculo_id: 701,
    tipo: "preventivo",
    urgente: false,
    fecha_inicio: "2098-11-18",
    fecha_fin: "2098-11-18",
    hora_inicio: "09:00",
    hora_fin: "11:00",
    motivo: "Servicio programado",
    ...overrides,
  });

  await t.test("exige autenticación y deja la gestión de bloqueos solo a Administración", async () => {
    assert.equal((await request(adminPath)).status, 401);
    assert.equal((await request(driverPath())).status, 401);
    assert.equal((await request(adminPath, { method: "POST", body: validPlannedBlock() })).status, 401);
    assert.equal((await request(adminPath, { token: tokens.client })).status, 403);
    assert.equal((await request(adminPath, { method: "POST", token: tokens.operativo, body: validPlannedBlock() })).status, 403);
    assert.equal((await request(driverPath(301), { method: "POST", token: tokens.driver, body: validPlannedBlock() })).status, 404);
    assert.equal((await request(`${driverPath()}/1/cerrar`, { method: "PATCH", token: tokens.driver })).status, 404);
    assert.equal(state.connectCalls, 0);
  });

  await t.test("administración puede listar y bloquear; operativo no puede crear ni cerrar", async () => {
    state.blocks.length = 0;
    const planned = validPlannedBlock({ tipo: "otro", hora_inicio: null, hora_fin: null });
    const created = await request(adminPath, { method: "POST", token: tokens.admin, body: planned });
    assert.equal(created.status, 201);
    const adminBlockId = created.body.indisponibilidad.id;
    assert.equal(created.body.indisponibilidad.rol_creador, "admin");
    assert.ok(state.notifications.some((notification) => notification.type === "user"));

    const list = await request(adminPath, { token: tokens.operativo });
    assert.equal(list.status, 200);
    assert.ok(list.body.some((block) => block.id === adminBlockId));

    const missingVehicle = await request(adminPath, {
      method: "POST", token: tokens.admin, body: validPlannedBlock({ vehiculo_id: 999 }),
    });
    assert.equal(missingVehicle.status, 404);

    const operativeClose = await request(`${adminPath}/${adminBlockId}/cerrar`, {
      method: "PATCH", token: tokens.operativo,
    });
    assert.equal(operativeClose.status, 403);

    const driverCloseAdminBlock = await request(`${driverPath()}/${adminBlockId}/cerrar`, {
      method: "PATCH", token: tokens.driver,
    });
    assert.equal(driverCloseAdminBlock.status, 404);

    const closedByAdmin = await request(`${adminPath}/${adminBlockId}/cerrar`, {
      method: "PATCH", token: tokens.admin,
    });
    assert.equal(closedByAdmin.status, 200);
    assert.equal(state.blocks.find((block) => block.id === adminBlockId).estado, "cerrada");
    assert.ok(state.notifications.some((notification) => notification.type === "user"));

    const closedAgain = await request(`${adminPath}/${adminBlockId}/cerrar`, {
      method: "PATCH", token: tokens.admin,
    });
    assert.equal(closedAgain.status, 404);
  });

});
