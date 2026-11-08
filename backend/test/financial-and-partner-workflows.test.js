const test = require("node:test");
const assert = require("node:assert/strict");

const state = {
  queries: [],
  reservation: null,
  operation: null,
  partnerVehicleCapacity: 8,
  hasOperationConflict: false,
  hasFleetOption: true,
  history: [],
  updates: [],
};

const result = (rows = []) => ({ rows, rowCount: rows.length });
const normalized = (sql) => sql.replace(/\s+/g, " ").trim().toLowerCase();

const pool = {
  async query(sql) {
    const query = normalized(sql);
    state.queries.push(query);
    if (query.startsWith("select session_version from usuarios")) return result([{ session_version: 0 }]);
    if (query.startsWith("select extract(month from fecha_reserva)::int as mes, count(*)::int as total")) return result([]);
    if (query.startsWith("select extract(isodow from fecha_reserva)::int as dow")) return result([]);
    if (query.startsWith("select coalesce(sum(monto_pagado), 0)::numeric as total")) return result([{ total: "60" }]);
    if (query.startsWith("select coalesce(avg(m.total), 0)::numeric as prom")) return result([{ prom: "50" }]);
    if (query.startsWith("select count(*)::int as total, count(*) filter")) return result([{ total: 1, aprobadas: 1 }]);
    if (query.startsWith("select origen, destino, count(*)::int as total")) return result([]);
    if (query.startsWith("select v.placa, (current_date - max(r.fecha_reserva)::date)")) return result([]);
    if (query.startsWith("select id from operaciones where reserva_id is distinct from")) {
      return result(state.hasOperationConflict ? [{ id: 700 }] : []);
    }
    if (query.startsWith("select id from reservas where id <>")) return result([]);
    if (query.startsWith("select v.id from vehiculos v where v.activo = true")) {
      return result(state.hasFleetOption ? [{ id: 10 }] : []);
    }
    throw new Error(`Unexpected pool query: ${query}`);
  },
  async connect() {
    return {
      async query(sql, params = []) {
        const query = normalized(sql);
        state.queries.push(query);
        if (["begin", "commit", "rollback"].includes(query)) return result();
        if (query.startsWith("select id, estado, fecha_reserva::text as fecha_reserva")) {
          return result(state.reservation ? [{ ...state.reservation }] : []);
        }
        if (query.startsWith("select * from operaciones where reserva_id")) return result([]);
        if (query.startsWith("select id from vehiculos where id = any")) return result([{ id: 701 }]);
        if (query.startsWith("select id, placa, case when activo")) return result([]);
        if (query.startsWith("select dia.fecha::date::text as fecha")) return result([]);
        if (query.startsWith("select id from mantenimiento_vehiculos")) return result([]);
        if (query.startsWith("select c.id from conductores c")) return result([]);
        if (query.startsWith("select id from operaciones where reserva_id is distinct from")) {
          return result(state.hasOperationConflict ? [{ id: 700 }] : []);
        }
        if (query.startsWith("select id from reservas where id <>")) return result([]);
        if (query.startsWith("update reservas set fecha_fin = case")) {
          state.updates.push({ query, params });
          return result();
        }
        if (query.startsWith("update cotizaciones")) return result();
        if (query.startsWith("insert into reserva_historial")) {
          state.history.push(JSON.parse(params[5]));
          return result();
        }
        if (query.startsWith("select * from operaciones where id = $1 for update")) {
          return result(state.operation ? [{ ...state.operation }] : []);
        }
        if (query.startsWith("select id, nombre, contacto, telefono, activa from empresas_asociadas")) {
          return result([{ id: 77, nombre: "Transporte Asociado", contacto: "Contacto", telefono: "0991234567", activa: true }]);
        }
        if (query.startsWith("select id, empresa_id, placa, modelo, capacidad, conductor, conductor_telefono, activo")) {
          return result([{
            id: 88,
            empresa_id: 77,
            placa: "ABC-1234",
            modelo: "Van",
            capacidad: state.partnerVehicleCapacity,
            conductor: "Conductor Asociado",
            conductor_telefono: "0991234567",
            activo: true,
          }]);
        }
        if (query.startsWith("select id from operaciones where id <> $1 and vehiculo_asociado_id")) {
          return result(state.hasOperationConflict ? [{ id: 701 }] : []);
        }
        if (query.startsWith("update operaciones set subcontratacion_estado")) {
          const [subcontractingState, company, contact, phone, vehicle, plate, driver, driverPhone, cost, operationState, id, companyId, partnerVehicleId] = params;
          Object.assign(state.operation, {
            subcontratacion_estado: subcontractingState,
            subcontratista_empresa: company,
            subcontratista_contacto: contact,
            subcontratista_telefono: phone,
            subcontratista_vehiculo: vehicle,
            subcontratista_placa: plate,
            subcontratista_conductor: driver,
            subcontratista_conductor_telefono: driverPhone,
            subcontratacion_costo: cost,
            estado: operationState,
            empresa_asociada_id: companyId,
            vehiculo_asociado_id: partnerVehicleId,
          });
          assert.equal(Number(id), state.operation.id);
          state.updates.push({ query, params });
          return result();
        }
        if (query.startsWith("insert into operacion_historial")) {
          state.history.push(JSON.parse(params[5]));
          return result();
        }
        if (query.startsWith("select o.*, v.placa as vehiculo_placa")) return result([{ ...state.operation }]);
        throw new Error(`Unexpected transaction query: ${query}`);
      },
      release() {},
    };
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

const mailerModule = require.resolve("../dist/config/reservaMailer");
require.cache[mailerModule] = {
  id: mailerModule,
  filename: mailerModule,
  loaded: true,
  exports: { notificarReprogramacion: async () => {} },
  children: [],
  paths: [],
};

const { getHistorialMensual } = require("../dist/controllers/admin/historial.admin.controller");
const { getAnaliticaInteligente } = require("../dist/controllers/admin/inteligencia.admin.controller");
const { consultarChatbotAdmin } = require("../dist/controllers/admin/chatbot.admin.controller");
const { getRutasDesdeReservas } = require("../dist/controllers/admin/rutas-analisis.admin.controller");
const { reprogramarMiReserva } = require("../dist/controllers/usuarios.controller");
const { actualizarSubcontratacion } = require("../dist/controllers/admin/operaciones.admin.controller");

const OLD_SERVICE_DATE = new Date(Date.UTC(new Date().getUTCFullYear() + 2, 10, 4)).toISOString().slice(0, 10);
const NEW_SERVICE_DATE = new Date(`${OLD_SERVICE_DATE}T00:00:00.000Z`);
NEW_SERVICE_DATE.setUTCDate(NEW_SERVICE_DATE.getUTCDate() + 7);
const RESCHEDULED_DATE = NEW_SERVICE_DATE.toISOString().slice(0, 10);

const response = () => ({
  statusCode: 200,
  body: null,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(body) {
    this.body = body;
    return this;
  },
});

test("los informes mensual e inteligente usan ingresos netos cobrados", async () => {
  state.queries = [];
  pool.query = async (sql) => {
    const query = normalized(sql);
    state.queries.push(query);
    if (query.startsWith("select extract(month from fecha_reserva)::int as mes, count(*) filter")) {
      return result([{ mes: 11, viajes: 1, pasajeros: 4, ingresos: "60", cancelados: 0 }]);
    }
    if (query.startsWith("select extract(month from coalesce(fecha_realizada")) return result([]);
    if (query.startsWith("select distinct extract(year from fecha_reserva)")) return result([{ anio: 2027 }]);
    if (query.startsWith("select extract(month from fecha_reserva)::int as mes, count(*)::int as total")) return result([]);
    if (query.startsWith("select extract(isodow from fecha_reserva)::int as dow")) return result([]);
    if (query.startsWith("select coalesce(sum(monto_pagado), 0)::numeric as total")) return result([{ total: "60" }]);
    if (query.startsWith("select coalesce(sum(monto_pagado), 0)::numeric as ingresos")) {
      return result([{ ingresos: "60", finalizados: "40", pagos_pendientes: 1 }]);
    }
    if (query.includes("sum(monto_pagado)") && query.includes("as ingresos") && query.includes("limit 30")) {
      return result([{
        origen: "Quito",
        destino: "Otavalo",
        viajes: 2,
        pasajeros: 8,
        ingresos: "60",
        prom_pasajeros: "4.0",
        cancelados: 0,
      }]);
    }
    if (query.startsWith("select coalesce(avg(m.total), 0)::numeric as prom")) return result([{ prom: "50" }]);
    if (query.startsWith("select count(*)::int as total, count(*) filter")) return result([{ total: 1, aprobadas: 1 }]);
    if (query.startsWith("select origen, destino, count(*)::int as total")) return result([]);
    if (query.startsWith("select v.placa, (current_date - max(r.fecha_reserva)::date)")) return result([]);
    if (query.startsWith("select id from operaciones where reserva_id is distinct from")) {
      return result(state.hasOperationConflict ? [{ id: 700 }] : []);
    }
    if (query.startsWith("select id from reservas where id <>")) return result([]);
    if (query.startsWith("select v.id from vehiculos v where v.activo = true")) {
      return result(state.hasFleetOption ? [{ id: 10 }] : []);
    }
    throw new Error(`Unexpected report query: ${query}`);
  };

  const monthlyResponse = response();
  await getHistorialMensual({ query: { anio: "2027" } }, monthlyResponse);
  assert.equal(monthlyResponse.statusCode, 200);
  assert.equal(monthlyResponse.body.resumen.ingresos, 60);
  assert.match(state.queries[0], /sum\(monto_pagado\)/);
  assert.doesNotMatch(state.queries[0], /sum\(total\)/);

  state.queries = [];
  const intelligenceResponse = response();
  await getAnaliticaInteligente({}, intelligenceResponse);
  assert.equal(intelligenceResponse.statusCode, 200);
  assert.equal(intelligenceResponse.body.proyeccion.ingresosMes, 60);
  assert.equal(intelligenceResponse.body.proyeccion.promedioHistorico, 50);
  const revenueQueries = state.queries.filter((query) => query.includes("sum("));
  assert.equal(revenueQueries.length, 2);
  assert.ok(revenueQueries.every((query) => /sum\(monto_pagado\)/.test(query)));

  state.queries = [];
  const chatbotResponse = response();
  await consultarChatbotAdmin({ body: { question: "ingresos del mes" } }, chatbotResponse);
  assert.equal(chatbotResponse.statusCode, 200);
  assert.match(chatbotResponse.body.answer, /cobrado netos \$60/);
  assert.match(state.queries[0], /sum\(monto_pagado\)/);
  assert.doesNotMatch(state.queries[0], /sum\(case when estado/);

  state.queries = [];
  const routesResponse = response();
  await getRutasDesdeReservas({}, routesResponse);
  assert.equal(routesResponse.statusCode, 200);
  assert.equal(routesResponse.body.resumen.total_ingresos, 60);
  assert.match(state.queries[0], /sum\(monto_pagado\)/);
  assert.doesNotMatch(state.queries[0], /sum\(case when estado <> 'cancelada'/);
});

test("reprograma en una fecha disponible y rechaza conflictos sin cambiar la reserva", async () => {
  const originalPoolQuery = pool.query;
  state.queries = [];
  state.history = [];
  state.updates = [];
  state.hasOperationConflict = true;
  state.reservation = {
    id: 501,
    estado: "confirmada",
    fecha_reserva: OLD_SERVICE_DATE,
    fecha_salida: `${OLD_SERVICE_DATE}T09:00:00`,
    fecha_llegada: `${OLD_SERVICE_DATE}T11:00:00`,
    fecha_fin: null,
    fecha_regreso: null,
    fecha_servicio: `${OLD_SERVICE_DATE}T09:00:00`,
    salida_hora: "09:00:00",
    llegada_hora: "11:00:00",
    hora_salida: "09:00",
    hora_regreso: null,
    num_personas: 4,
    vehiculo_id: 701,
    conductor_id: null,
  };

  const makeRequest = () => ({
    user: { id: 99 },
    params: { id: "501" },
    body: { fecha: RESCHEDULED_DATE },
  });
  const blockedResponse = response();
  await reprogramarMiReserva(makeRequest(), blockedResponse);
  assert.equal(blockedResponse.statusCode, 409);
  assert.equal(state.updates.length, 0);

  state.hasOperationConflict = false;
  const availableResponse = response();
  await reprogramarMiReserva(makeRequest(), availableResponse);
  assert.equal(availableResponse.statusCode, 200);
  assert.equal(state.updates.length, 1);
  assert.equal(state.updates[0].params[0], RESCHEDULED_DATE);
  assert.equal(state.updates[0].params[1], OLD_SERVICE_DATE);
  assert.equal(state.history.length, 1);
  assert.equal(state.history[0].fecha_anterior, OLD_SERVICE_DATE);
  assert.equal(state.history[0].fecha_nueva, RESCHEDULED_DATE);
  pool.query = originalPoolQuery;
});

test("valida capacidad y conflictos de agenda antes de confirmar vehículo asociado", async () => {
  const originalPoolQuery = pool.query;
  state.queries = [];
  state.history = [];
  state.updates = [];
  state.operation = {
    id: 1001,
    reserva_id: null,
    estado: "programada",
    subcontratacion_estado: "no_requerida",
    pasajeros: 4,
    fecha_programada: RESCHEDULED_DATE,
    fecha_fin_programada: RESCHEDULED_DATE,
    hora_inicio: "09:00",
    hora_fin: "11:00",
  };

  const makeRequest = () => ({
    params: { id: "1001" },
    user: { id: 99 },
    body: {
      estado: "confirmada",
      empresa_asociada_id: 77,
      vehiculo_asociado_id: 88,
      costo: 150,
    },
  });

  state.partnerVehicleCapacity = 3;
  state.hasOperationConflict = false;
  const insufficientCapacity = response();
  await actualizarSubcontratacion(makeRequest(), insufficientCapacity);
  assert.equal(insufficientCapacity.statusCode, 409);
  assert.equal(state.updates.length, 0);

  state.partnerVehicleCapacity = 8;
  state.hasOperationConflict = true;
  const conflicting = response();
  await actualizarSubcontratacion(makeRequest(), conflicting);
  assert.equal(conflicting.statusCode, 409);
  assert.equal(state.updates.length, 0);

  state.hasOperationConflict = false;
  const assigned = response();
  await actualizarSubcontratacion(makeRequest(), assigned);
  assert.equal(assigned.statusCode, 200);
  assert.equal(assigned.body.data.subcontratacion_estado, "confirmada");
  assert.equal(assigned.body.data.empresa_asociada_id, 77);
  assert.equal(assigned.body.data.vehiculo_asociado_id, 88);
  assert.equal(assigned.body.data.subcontratista_placa, "ABC-1234");
  assert.equal(state.updates.length, 1);
  assert.equal(state.history.length, 1);
  pool.query = originalPoolQuery;
});
