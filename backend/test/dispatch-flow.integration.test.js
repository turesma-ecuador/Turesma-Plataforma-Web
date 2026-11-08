const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const jwt = require("jsonwebtoken");

process.env.JWT_SECRET = "dispatch-flow-integration-test-secret";

const state = {
  reservations: [
    {
      id: 801,
      fecha_reserva: "2026-10-19",
      fecha_servicio: "2026-10-21T09:00:00.000Z",
      fecha_salida: "2026-10-21T09:00:00.000Z",
      fecha_llegada: "2026-10-21T11:00:00.000Z",
      fecha_regreso: "2026-10-23",
      origen: "Quito",
      destino: "Otavalo",
      num_personas: 8,
      total: 240,
      estado: "confirmada",
      vehiculo_id: null,
      conductor_id: null,
      usuario_id: 901,
      cliente_nombre: "Cliente de prueba",
    },
    {
      id: 802,
      fecha_reserva: "2026-10-19",
      fecha_servicio: "2026-10-22T09:00:00.000Z",
      fecha_salida: "2026-10-22T09:00:00.000Z",
      fecha_llegada: "2026-10-22T11:00:00.000Z",
      origen: "Quito",
      destino: "Cotacachi",
      num_personas: 5,
      total: 150,
      estado: "confirmada",
      vehiculo_id: null,
      conductor_id: null,
      usuario_id: 902,
      cliente_nombre: "Segundo cliente",
    },
    {
      id: 803,
      fecha_reserva: "2026-10-19",
      fecha_servicio: "2026-10-21T09:00:00.000Z",
      fecha_salida: "2026-10-21T09:00:00.000Z",
      fecha_llegada: "2026-10-21T11:00:00.000Z",
      origen: "Quito",
      destino: "Latacunga",
      num_personas: 4,
      total: 120,
      estado: "confirmada",
      vehiculo_id: 701,
      conductor_id: 301,
      usuario_id: 903,
      cliente_nombre: "Reserva que ocupa recursos",
    },
  ],
  vehicles: [
    { id: 701, placa: "TEST-701", modelo: "Van test 1", capacidad: 12, estado: "disponible", activo: true, usuario_id: 301 },
    { id: 702, placa: "TEST-702", modelo: "Van test 2", capacidad: 15, estado: "disponible", activo: true, usuario_id: 302 },
  ],
  drivers: [
    { id: 501, usuario_id: 301, estado: "disponible", activo: true, fecha_licencia_vencimiento: "2027-12-31" },
    { id: 502, usuario_id: 302, estado: "disponible", activo: true, fecha_licencia_vencimiento: "2027-12-31" },
  ],
  operations: [],
  maintenance: [],
  availability: [],
  decisions: [],
  history: [],
  nextOperationId: 1001,
  nextDecisionId: 2001,
};

const result = (rows = []) => ({ rows, rowCount: rows.length });
const asDate = (value) => value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
const asTime = (value) => {
  if (value instanceof Date) return value.toISOString().slice(11, 19);
  const text = String(value || "");
  return text.includes("T") ? text.slice(11, 19) : text.slice(0, 8);
};
const intersects = (startA, endA, startB, endB) => !startA || !endA || !startB || !endB || (startA < endB && startB < endA);

const reservationFor = (id) => state.reservations.find((row) => row.id === Number(id));
const operationFor = (id) => state.operations.find((row) => row.id === Number(id));
const vehicleFor = (id) => state.vehicles.find((row) => row.id === Number(id));
const driverForUser = (id) => state.drivers.find((row) => row.usuario_id === Number(id));

const operationView = (operation) => {
  if (!operation) return null;
  const vehicle = vehicleFor(operation.vehiculo_id);
  const driver = state.drivers.find((row) => row.id === operation.conductor_id);
  return {
    ...operation,
    vehiculo_placa: vehicle?.placa || null,
    vehiculo_modelo: vehicle?.modelo || null,
    conductor_usuario_id: driver?.usuario_id || null,
    conductor_nombre: driver ? `Conductor ${driver.usuario_id}` : null,
    conductor_apellido: null,
  };
};

const pool = {
  async query(sql, params = []) {
    const query = sql.replace(/\s+/g, " ").trim().toLowerCase();
    if (query.startsWith("select session_version from usuarios")) return result([{ session_version: 0 }]);
    if (query.startsWith("select coalesce(o.fecha_fin_programada")) {
      const operation = operationFor(params[0]);
      const reservation = operation?.reserva_id ? reservationFor(operation.reserva_id) : null;
      return result(operation ? [{
        fecha_fin: operation.fecha_fin_programada || reservation?.fecha_fin || reservation?.fecha_regreso || operation.fecha_programada,
      }] : []);
    }
    if (query.startsWith("with vehiculos_evaluados as")) {
      const [startValue, endValue, passengers, operationId, startTime, endTime] = params;
      const startDate = asDate(startValue);
      const endDate = asDate(endValue);
      const operation = operationFor(operationId);
      const dates = [];
      for (let date = new Date(`${startDate}T00:00:00.000Z`); asDate(date) <= endDate; date.setUTCDate(date.getUTCDate() + 1)) {
        dates.push(asDate(date));
      }
      const rows = state.vehicles.map((vehicle) => {
        const blockers = [];
        if (!vehicle.activo) blockers.push("Vehículo desactivado");
        if (vehicle.estado !== "disponible") blockers.push(`Estado del vehículo: ${vehicle.estado}`);
        if (vehicle.capacidad < Number(passengers)) blockers.push(`Capacidad insuficiente: ${vehicle.capacidad} plazas para ${passengers} pasajeros`);
        for (const date of dates) {
          const manual = state.availability.find((entry) => entry.vehiculo_id === vehicle.id && entry.fecha === date);
          const dayOfWeek = new Date(`${date}T00:00:00.000Z`).getUTCDay();
          if (manual?.disponible === false) blockers.push(`No disponible según calendario manual el ${date}`);
          else if (manual?.disponible !== true && vehicle.dias_servicio && !vehicle.dias_servicio.includes(dayOfWeek)) {
            blockers.push(`No ofrece servicio los días: ${date}`);
          }
        }
        const maintenance = state.maintenance.find((item) =>
          item.vehiculo_id === vehicle.id
          && (item.estado === "en_progreso"
            || (item.estado === "programado" && item.fecha_programada >= startDate && item.fecha_programada <= endDate))
        );
        if (maintenance) blockers.push(maintenance.estado === "en_progreso"
          ? "Mantenimiento en curso"
          : `Mantenimiento programado el ${maintenance.fecha_programada}`);
        const reservationConflict = state.reservations.find((reservation) => {
          const reservationStart = asDate(reservation.fecha_salida || reservation.fecha_servicio || reservation.fecha_reserva);
          const reservationEnd = asDate(reservation.fecha_fin || reservation.fecha_regreso || reservation.fecha_llegada || reservationStart);
          if (reservation.vehiculo_id !== vehicle.id || reservationStart > endDate || reservationEnd < startDate
            || ["cancelada", "finalizada"].includes(reservation.estado)
            || reservation.id === operation?.reserva_id) return false;
          if (startDate !== endDate || reservationStart !== reservationEnd) return true;
          return intersects(startTime ? asTime(startTime) : null, endTime ? asTime(endTime) : null,
            reservation.fecha_salida && asTime(reservation.fecha_salida), reservation.fecha_llegada && asTime(reservation.fecha_llegada));
        });
        if (reservationConflict) blockers.push(`Conflicto con reserva #${reservationConflict.id}`);
        const operationConflict = state.operations.find((other) =>
          other.id !== Number(operationId)
          && other.vehiculo_id === vehicle.id
          && other.fecha_programada <= endDate
          && asDate(other.fecha_fin_programada || other.fecha_programada) >= startDate
          && ["programada", "asignada", "en_curso", "incidencia"].includes(other.estado)
        );
        if (operationConflict) blockers.push(`Conflicto con operación #${operationConflict.id}`);
        return {
          vehiculo_id: vehicle.id,
          placa: vehicle.placa,
          modelo: vehicle.modelo,
          tipo: "van",
          capacidad: vehicle.capacidad,
          estado: vehicle.estado,
          activo: vehicle.activo,
          fecha_proximo_mantenimiento: null,
          kilometraje: 10000,
          proximo_km_mantenimiento: null,
          conductor_id: vehicle.usuario_id,
          conductor_nombre: `Conductor ${vehicle.usuario_id}`,
          bloqueos: blockers,
          advertencias: [],
        };
      });
      return result(rows);
    }
    if (query.startsWith("with candidatos as")) {
      const [dateValue, passengers, startValue, endValue, operationId, requestedEndDate, eligibleVehicleIds] = params;
      const date = asDate(dateValue);
      const endDate = asDate(operationFor(operationId)?.fecha_fin_programada || requestedEndDate || dateValue);
      const start = startValue ? asTime(startValue) : null;
      const end = endValue ? asTime(endValue) : null;
      const candidates = state.vehicles
        .filter((vehicle) => vehicle.activo && vehicle.estado === "disponible" && vehicle.capacidad >= passengers)
        .filter((vehicle) => eligibleVehicleIds.includes(vehicle.id))
        .filter((vehicle) => {
          const maintenanceConflict = state.maintenance.some((maintenance) =>
            maintenance.vehiculo_id === vehicle.id
            && (maintenance.estado === "en_progreso"
              || (maintenance.estado === "programado"
                && maintenance.fecha_programada >= date
                && maintenance.fecha_programada <= endDate))
          );
          const reservationConflict = state.reservations.some((reservation) => {
            const reservationDate = asDate(reservation.fecha_salida || reservation.fecha_servicio || reservation.fecha_reserva);
            if (reservation.vehiculo_id !== vehicle.id || reservationDate !== date || ["cancelada", "finalizada"].includes(reservation.estado)) return false;
            if (operationFor(operationId)?.reserva_id === reservation.id) return false;
            return intersects(start, end, reservation.fecha_salida && asTime(reservation.fecha_salida), reservation.fecha_llegada && asTime(reservation.fecha_llegada));
          });
          const operationConflict = state.operations.some((operation) =>
            operation.id !== Number(operationId)
            && operation.fecha_programada === date
            && ["programada", "asignada", "en_curso", "incidencia"].includes(operation.estado)
            && operation.vehiculo_id === vehicle.id
            && intersects(start, end, operation.hora_inicio, operation.hora_fin)
          );
          return !maintenanceConflict && !reservationConflict && !operationConflict;
        })
        .map((vehicle) => {
          const driver = state.drivers.find((row) => row.usuario_id === vehicle.usuario_id);
          return {
            vehiculo_id: vehicle.id,
            placa: vehicle.placa,
            modelo: vehicle.modelo,
            tipo: "van",
            capacidad: vehicle.capacidad,
            fecha_proximo_mantenimiento: "2027-12-31",
            conductor_id: driver?.usuario_id || null,
            conductor_nombre: driver ? `Conductor ${driver.usuario_id}` : null,
            rating: 4.5,
            calificacion_registrada: true,
            carga_30_dias: 1,
            kilometraje: 10000,
            mantenimiento_ok: 1,
            puntaje_capacidad: 6,
            puntaje_calificacion: 22.5,
            puntaje_mantenimiento: 25,
            puntaje_carga: 19,
            puntaje: 72.5,
          };
        })
        .slice(0, 5);
      return result(candidates);
    }

    if (query.startsWith("insert into decisiones_sistema")) {
      const decision = {
        id: state.nextDecisionId++,
        tipo_decision: "asignacion_vehiculo",
        entidad_id: params[0],
        recomendacion: JSON.parse(params[1]),
        factores: JSON.parse(params[2]),
        resultado: null,
      };
      state.decisions.push(decision);
      return result([{ id: decision.id }]);
    }

    if (query.startsWith("select r.id, r.fecha_reserva")) {
      const rows = state.reservations
        .filter((reservation) => reservation.estado === "confirmada")
        .filter((reservation) => {
          const cancelledOperation = state.operations.some((operation) => operation.reserva_id === reservation.id && operation.estado === "cancelada");
          const activeOperation = state.operations.some((operation) => operation.reserva_id === reservation.id && operation.estado !== "cancelada");
          return (!reservation.vehiculo_id || !reservation.conductor_id || cancelledOperation) && !activeOperation;
        })
        .map((reservation) => ({
          ...reservation,
          operacion_cancelada_id: state.operations
            .filter((operation) => operation.reserva_id === reservation.id && operation.estado === "cancelada")
            .sort((a, b) => b.id - a.id)[0]?.id || null,
          vehiculo_placa: vehicleFor(reservation.vehiculo_id)?.placa || null,
        }));
      return result(rows);
    }

    throw new Error(`Unexpected pool query in integration test: ${query}`);
  },
  async connect() {
    let snapshot;
    return {
      async query(sql, params = []) {
        const query = sql.replace(/\s+/g, " ").trim().toLowerCase();

        if (query === "begin") {
          snapshot = structuredClone(state);
          return result();
        }
        if (query === "commit") return result();
        if (query === "rollback") {
          if (snapshot) {
            for (const key of Object.keys(state)) delete state[key];
            Object.assign(state, snapshot);
          }
          return result();
        }
        if (query.startsWith("select id, fecha_reserva, fecha_servicio")) {
          const reservation = reservationFor(params[0]);
          return result(reservation ? [{ ...reservation }] : []);
        }
        if (query.startsWith("select id from operaciones where reserva_id")) {
          return result(state.operations.filter((operation) => operation.reserva_id === Number(params[0])).map(({ id }) => ({ id })));
        }
        if (query.startsWith("insert into operaciones")) {
          const [reservationId, , , reservationDate, , fechaFin, fechaRegreso, origin, destination, passengers, vehicleId, driverId, operationState, createdBy] = params;
          const reservation = reservationFor(reservationId);
          const scheduled = reservation.fecha_salida || reservation.fecha_servicio || reservationDate;
          const start = reservation.fecha_salida ? asTime(reservation.fecha_salida) : null;
          const finish = reservation.fecha_llegada && asDate(reservation.fecha_llegada) === asDate(scheduled)
            ? asTime(reservation.fecha_llegada)
            : null;
          const operation = {
            id: state.nextOperationId++,
            reserva_id: Number(reservationId),
            tipo_servicio: "reserva",
            fecha_programada: asDate(scheduled),
            fecha_fin_programada: asDate(fechaFin || fechaRegreso || scheduled),
            hora_inicio: start,
            hora_fin: finish,
            origen: origin,
            destino: destination,
            pasajeros: Number(passengers),
            estado: operationState,
            vehiculo_id: vehicleId,
            conductor_id: driverId,
            creado_por: createdBy,
          };
          state.operations.push(operation);
          return result([{ id: operation.id }]);
        }
        if (query.startsWith("insert into operacion_historial")) {
          state.history.push({
            operacion_id: Number(params[0]),
            accion: params[2],
            estado_anterior: params[3],
            estado_nuevo: params[4],
            detalle: JSON.parse(params[5]),
          });
          return result();
        }
        if (query.startsWith("select o.*, v.placa")) {
          return result([operationView(operationFor(params[0]))].filter(Boolean));
        }
        if (query.startsWith("select * from operaciones where id")) {
          const operation = operationFor(params[0]);
          return result(operation ? [{ ...operation }] : []);
        }
        if (query.startsWith("select id, placa, capacidad, estado, activo")) {
          const vehicle = vehicleFor(params[0]);
          return result(vehicle ? [{ ...vehicle, mantenimiento_vencido: false }] : []);
        }
        if (query.startsWith("select dia.fecha::date::text as fecha, case when vd.disponible = false then 'bloqueo manual'")) {
          const [vehicleId, startValue, endValue] = params;
          const vehicle = vehicleFor(vehicleId);
          const startDate = asDate(startValue);
          const endDate = asDate(endValue);
          for (let date = new Date(`${startDate}T00:00:00.000Z`); asDate(date) <= endDate; date.setUTCDate(date.getUTCDate() + 1)) {
            const dateValue = asDate(date);
            const manual = state.availability.find((entry) => entry.vehiculo_id === Number(vehicleId) && entry.fecha === dateValue);
            const dayOfWeek = new Date(`${dateValue}T00:00:00.000Z`).getUTCDay();
            if (manual?.disponible === false) return result([{ fecha: dateValue, motivo: "bloqueo manual" }]);
            if (manual?.disponible !== true && vehicle.dias_servicio && !vehicle.dias_servicio.includes(dayOfWeek)) {
              return result([{ fecha: dateValue, motivo: "día no laborable" }]);
            }
          }
          return result();
        }
        if (query.startsWith("select id, tipo, fecha_programada::text as fecha_programada, estado from mantenimiento_vehiculos")) {
          const [vehicleId, startDateValue, endDateValue] = params;
          const startDate = asDate(startDateValue);
          const endDate = asDate(endDateValue);
          const maintenance = state.maintenance.find((item) =>
            item.vehiculo_id === Number(vehicleId)
            && (item.estado === "en_progreso"
              || (item.estado === "programado"
                && item.fecha_programada >= startDate
                && item.fecha_programada <= endDate))
          );
          return result(maintenance ? [{ ...maintenance }] : []);
        }
        if (query.startsWith("select id, fecha_inicio::text, fecha_fin::text, hora_inicio::text, hora_fin::text, motivo")) {
          return result([]);
        }
        if (query.startsWith("select c.id, c.usuario_id, c.estado")) {
          const driver = driverForUser(params[0]);
          return result(driver ? [{ ...driver }] : []);
        }
        if (query.startsWith("select fecha_fin::text as fecha_fin, fecha_regreso::text as fecha_regreso from reservas")) {
          const reservation = reservationFor(params[0]);
          return result(reservation ? [{
            fecha_fin: reservation.fecha_fin || null,
            fecha_regreso: reservation.fecha_regreso || null,
          }] : []);
        }
        if (query.startsWith("select o.id, o.vehiculo_id, o.conductor_id")) {
          const [operationId, startDateValue, endDateValue, startValue, endValue, activeStates, vehicleId, driverUserId, driverId] = params;
          const startDate = asDate(startDateValue);
          const endDate = asDate(endDateValue);
          const start = startValue ? asTime(startValue) : null;
          const end = endValue ? asTime(endValue) : null;
          const conflict = state.operations.find((operation) =>
            operation.id !== Number(operationId)
            && operation.fecha_programada <= endDate
            && asDate(operation.fecha_fin_programada || operation.fecha_programada) >= startDate
            && activeStates.includes(operation.estado)
            && (operation.vehiculo_id === Number(vehicleId) || operation.conductor_id === driverForUser(driverUserId)?.id)
            && (startDate !== endDate || operation.fecha_programada !== asDate(operation.fecha_fin_programada || operation.fecha_programada)
              || intersects(start, end, operation.hora_inicio, operation.hora_fin))
          );
          return result(conflict ? [{
            ...conflict,
            placa: vehicleFor(conflict.vehiculo_id)?.placa,
            conductor_nombre: `Conductor ${driverForUser(driverId)?.usuario_id}`,
          }] : []);
        }
        if (query.startsWith("select r.id as reserva_id, r.vehiculo_id, v.placa")) {
          const [operationId, startDateValue, endDateValue, startValue, endValue, , vehicleId, driverUserId, driverId] = params;
          const operation = operationFor(operationId);
          const startDate = asDate(startDateValue);
          const endDate = asDate(endDateValue);
          const start = startValue ? asTime(startValue) : null;
          const end = endValue ? asTime(endValue) : null;
          const conflict = state.reservations.find((reservation) => {
            const reservationDate = asDate(reservation.fecha_salida || reservation.fecha_servicio || reservation.fecha_reserva);
            const reservationEndDate = asDate(reservation.fecha_fin || reservation.fecha_regreso || reservationDate);
            if (reservation.id === operation?.reserva_id
              || reservationDate > endDate || reservationEndDate < startDate
              || ["cancelada", "finalizada"].includes(reservation.estado)) return false;
            const conductorOcupado = reservation.conductor_id === Number(driverUserId)
              || reservation.conductor_id === Number(driverId);
            if (reservation.vehiculo_id !== Number(vehicleId) && !conductorOcupado) return false;
            return startDate !== endDate || reservationDate !== reservationEndDate || intersects(
              start,
              end,
              reservation.fecha_salida && asTime(reservation.fecha_salida),
              reservation.fecha_llegada && asTime(reservation.fecha_llegada)
            );
          });
          return result(conflict ? [{ reserva_id: conflict.id, vehiculo_id: conflict.vehiculo_id, placa: vehicleFor(conflict.vehiculo_id)?.placa }] : []);
        }
        if (query.startsWith("update operaciones set vehiculo_id")) {
          const operation = operationFor(params[2]);
          Object.assign(operation, { vehiculo_id: Number(params[0]), conductor_id: Number(params[1]), estado: "asignada" });
          return result();
        }
        if (query.startsWith("update operaciones set subcontratacion_estado")) {
          const [
            subcontractingState,
            company,
            contact,
            phone,
            vehicle,
            plate,
            driver,
            driverPhone,
            cost,
            operationState,
            operationId,
          ] = params;
          Object.assign(operationFor(operationId), {
            subcontratacion_estado: subcontractingState,
            subcontratista_empresa: company,
            subcontratista_contacto: contact,
            subcontratista_telefono: phone,
            subcontratista_vehiculo: vehicle,
            subcontratista_placa: plate,
            subcontratista_conductor: driver,
            subcontratista_conductor_telefono: driverPhone,
            subcontratacion_costo: cost,
            vehiculo_id: null,
            conductor_id: null,
            estado: operationState,
          });
          return result();
        }
        if (query.startsWith("select id, estado from reservas") || query.startsWith("select id, estado, estado_operativo from reservas")) {
          const reservation = reservationFor(params[0]);
          return result(reservation ? [{ id: reservation.id, estado: reservation.estado, estado_operativo: reservation.estado_operativo }] : []);
        }
        if (query.includes("information_schema.table_constraints")) {
          return result([{ referenced_table: "usuarios" }]);
        }
        if (query.startsWith("update reservas set vehiculo_id = $1, conductor_id")) {
          const reservation = reservationFor(params[2]);
          Object.assign(reservation, { vehiculo_id: Number(params[0]), conductor_id: Number(params[1]), estado_operativo: "asignada" });
          return result();
        }
        if (query.startsWith("update reservas set estado_operativo = $1 where id = $2")) {
          const reservation = reservationFor(params[1]);
          if (reservation) reservation.estado_operativo = params[0];
          return result();
        }
        if (query.startsWith("update decisiones_sistema")) {
          const [decisionId, vehicleId, confirmedBy, reason, operationId, date, passengers, start, end, endDate] = params;
          const decision = state.decisions.find((row) => row.id === Number(decisionId));
          if (!decision || decision.resultado !== null
            || decision.recomendacion.operacion_id !== Number(operationId)
            || decision.recomendacion.fecha !== asDate(date)
            || decision.recomendacion.fecha_fin !== asDate(endDate)
            || decision.recomendacion.pasajeros !== Number(passengers)
            || decision.recomendacion.hora_inicio !== (start ? asTime(start).slice(0, 5) : null)
            || decision.recomendacion.hora_fin !== (end ? asTime(end).slice(0, 5) : null)) return result();
          const isRecommended = decision.recomendacion.vehiculo.vehiculo_id === Number(vehicleId);
          const isAlternative = decision.recomendacion.alternativas.some((item) => item.vehiculo_id === Number(vehicleId));
          if (!isRecommended && (!isAlternative || !String(reason).trim())) return result();
          decision.entidad_id = Number(vehicleId);
          decision.resultado = isRecommended ? "aceptada" : "alternativa";
          decision.confirmado_por = Number(confirmedBy);
          decision.factores.decision_operador = { vehiculo_id: Number(vehicleId), motivo: reason || null, operacion_id: Number(operationId) };
          return result([{ id: decision.id }]);
        }
        if (query.startsWith("update operaciones set estado = $1,")) {
          const operation = operationFor(params[1]);
          operation.estado = params[0];
          return result();
        }
        if (query.startsWith("update reservas set estado = $1")) {
          const reservation = reservationFor(params[1]);
          reservation.estado = params[0];
          return result();
        }
        if (query.startsWith("update reservas set vehiculo_id = null, conductor_id = null where id = $1 and estado = 'confirmada'")) {
          const reservation = reservationFor(params[0]);
          if (reservation?.estado === "confirmada") Object.assign(reservation, { vehiculo_id: null, conductor_id: null });
          return result();
        }
        if (query.startsWith("update reservas set vehiculo_id = null, conductor_id = null, estado_operativo = null where id = $1")) {
          const reservation = reservationFor(params[0]);
          if (reservation?.estado === "confirmada") Object.assign(reservation, { vehiculo_id: null, conductor_id: null, estado_operativo: null });
          return result();
        }
        if (query.startsWith("update reservas set vehiculo_id = null, conductor_id = null where id = $1")) {
          const reservation = reservationFor(params[0]);
          if (reservation) Object.assign(reservation, { vehiculo_id: null, conductor_id: null });
          return result();
        }
        if (query.startsWith("update operaciones set estado = 'programada'")) {
          const operation = operationFor(params[0]);
          Object.assign(operation, { estado: "programada", vehiculo_id: null, conductor_id: null });
          return result();
        }

        throw new Error(`Unexpected client query in integration test: ${query}`);
      },
      release() {},
    };
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
const token = jwt.sign({ id: 99, email: "dispatch-test@example.invalid", rol: "admin" }, process.env.JWT_SECRET);

test("despacha, recomienda, asigna, sincroniza estados y reabre usando HTTP con base aislada", async (t) => {
  await new Promise((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  t.after(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));

  const request = async (path, { method = "GET", body, authenticated = true } = {}) => {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        ...(authenticated ? { Authorization: `Bearer ${token}` } : {}),
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, body: await response.json() };
  };

  await t.test("bloquea acceso sin token", async () => {
    const response = await request("/api/admin/operaciones/reservas-pendientes", { authenticated: false });
    assert.equal(response.status, 401);
  });

  await t.test("confirma el recorrido de reserva hasta asignación y finalización", async () => {
    const pending = await request("/api/admin/operaciones/reservas-pendientes");
    assert.equal(pending.status, 200);
    assert.ok(pending.body.data.some((reservation) => reservation.id === 801));

    const created = await request("/api/admin/operaciones/reservas/801/despachar", { method: "POST", body: {} });
    assert.equal(created.status, 201);
    const operationId = created.body.data.id;
    assert.equal(created.body.data.reserva_id, 801);
    assert.equal(created.body.data.estado, "programada");

    const duplicate = await request("/api/admin/operaciones/reservas/801/despachar", { method: "POST", body: {} });
    assert.equal(duplicate.status, 409);

    state.maintenance.push({ id: 1, vehiculo_id: 702, tipo: "Preventivo", fecha_programada: "2026-10-23", estado: "programado" });
    const maintenanceRecommendation = await request(`/api/admin/inteligencia/asignacion-recomendada?fecha=2026-10-21&fecha_fin=2026-10-23&pasajeros=8&hora_inicio=09%3A00&hora_fin=11%3A00&operacion_id=${operationId}`);
    assert.equal(maintenanceRecommendation.status, 200);
    assert.equal(maintenanceRecommendation.body.data.vehiculo, null);
    assert.match(maintenanceRecommendation.body.data.excluidos.find((vehicle) => vehicle.vehiculo_id === 702).bloqueos[0], /mantenimiento programado/i);
    const maintenanceAssignment = await request(`/api/admin/operaciones/${operationId}/asignar`, {
      method: "PATCH",
      body: { vehiculo_id: 702, conductor_id: 302 },
    });
    assert.equal(maintenanceAssignment.status, 409);
    assert.match(maintenanceAssignment.body.error, /mantenimiento programado/i);
    state.maintenance.length = 0;

    state.availability.push({ vehiculo_id: 702, fecha: "2026-10-21", disponible: false });
    const manualBlockRecommendation = await request(`/api/admin/inteligencia/asignacion-recomendada?fecha=2026-10-21&fecha_fin=2026-10-23&pasajeros=8&hora_inicio=09%3A00&hora_fin=11%3A00&operacion_id=${operationId}`);
    assert.equal(manualBlockRecommendation.body.data.vehiculo, null);
    assert.match(manualBlockRecommendation.body.data.excluidos.find((vehicle) => vehicle.vehiculo_id === 702).bloqueos[0], /calendario manual/i);
    const manualBlockAssignment = await request(`/api/admin/operaciones/${operationId}/asignar`, {
      method: "PATCH",
      body: { vehiculo_id: 702, conductor_id: 302 },
    });
    assert.equal(manualBlockAssignment.status, 409);
    assert.match(manualBlockAssignment.body.error, /bloqueado manualmente/i);
    state.availability.length = 0;

    const unavailableVehicle = await request(`/api/admin/operaciones/${operationId}/asignar`, {
      method: "PATCH",
      body: { vehiculo_id: 701, conductor_id: 302 },
    });
    assert.equal(unavailableVehicle.status, 409);
    assert.match(unavailableVehicle.body.error, /No Disponible.*vehículo/i);

    const unavailableDriver = await request(`/api/admin/operaciones/${operationId}/asignar`, {
      method: "PATCH",
      body: { vehiculo_id: 702, conductor_id: 301 },
    });
    assert.equal(unavailableDriver.status, 409);
    assert.match(unavailableDriver.body.error, /No Disponible.*conductor/i);
    assert.equal(operationFor(operationId).vehiculo_id, null);

    const recommendation = await request(`/api/admin/inteligencia/asignacion-recomendada?fecha=2026-10-21&pasajeros=8&hora_inicio=09%3A00&hora_fin=11%3A00&operacion_id=${operationId}`);
    assert.equal(recommendation.status, 200);
    const suggestedVehicleId = recommendation.body.data.vehiculo.vehiculo_id;
    assert.ok(recommendation.body.data.decisionId);

    const assigned = await request(`/api/admin/operaciones/${operationId}/asignar`, {
      method: "PATCH",
      body: {
        vehiculo_id: suggestedVehicleId,
        conductor_id: recommendation.body.data.vehiculo.conductor_id,
        decision_id: recommendation.body.data.decisionId,
        decision_reason: "",
      },
    });
    assert.equal(assigned.status, 200, JSON.stringify(assigned.body));
    assert.equal(assigned.body.data.estado, "asignada");
    assert.equal(assigned.body.data.vehiculo_id, suggestedVehicleId);
    assert.equal(state.reservations[0].vehiculo_id, suggestedVehicleId);
    assert.equal(state.decisions[0].resultado, "aceptada");

    const started = await request(`/api/admin/operaciones/${operationId}/estado`, { method: "PATCH", body: { estado: "en_curso" } });
    assert.equal(started.status, 403);
    assert.equal(state.reservations[0].estado, "confirmada");
    assert.equal(state.reservations[0].estado_operativo, "asignada");

    const completed = await request(`/api/admin/operaciones/${operationId}/estado`, { method: "PATCH", body: { estado: "completada" } });
    assert.equal(completed.status, 403);
    assert.equal(state.reservations[0].estado, "confirmada");
    operationFor(operationId).estado = "completada";
    state.reservations[0].estado = "finalizada";
    state.reservations[0].estado_operativo = "finalizada";
  });

  await t.test("devuelve una reserva cancelada a la cola y reabre la operación existente", async () => {
    const created = await request("/api/admin/operaciones/reservas/802/despachar", { method: "POST", body: {} });
    assert.equal(created.status, 201);
    const operationId = created.body.data.id;

    const cancelled = await request(`/api/admin/operaciones/${operationId}/estado`, { method: "PATCH", body: { estado: "cancelada" } });
    assert.equal(cancelled.status, 200);
    assert.equal(state.reservations[1].vehiculo_id, null);
    assert.equal(state.reservations[1].conductor_id, null);

    const pending = await request("/api/admin/operaciones/reservas-pendientes");
    const reopenedReservation = pending.body.data.find((reservation) => reservation.id === 802);
    assert.equal(reopenedReservation.operacion_cancelada_id, operationId);

    const reopened = await request(`/api/admin/operaciones/${operationId}/reabrir`, { method: "PATCH", body: {} });
    assert.equal(reopened.status, 200);
    assert.equal(reopened.body.data.estado, "programada");
    assert.equal(state.operations.filter((operation) => operation.reserva_id === 802).length, 1);
    assert.equal(state.history.some((entry) => entry.operacion_id === operationId && entry.accion === "reapertura_despacho"), true);

    const recommendation = await request(`/api/admin/inteligencia/asignacion-recomendada?fecha=2026-10-22&pasajeros=5&hora_inicio=09%3A00&hora_fin=11%3A00&operacion_id=${operationId}`);
    assert.equal(recommendation.status, 200);
    const alternativeVehicle = recommendation.body.data.alternativas[0];
    assert.ok(alternativeVehicle);

    const missingReason = await request(`/api/admin/operaciones/${operationId}/asignar`, {
      method: "PATCH",
      body: {
        vehiculo_id: alternativeVehicle.vehiculo_id,
        conductor_id: alternativeVehicle.conductor_id,
        decision_id: recommendation.body.data.decisionId,
      },
    });
    assert.equal(missingReason.status, 409);
    assert.equal(operationFor(operationId).vehiculo_id, null);

    const assignedAlternative = await request(`/api/admin/operaciones/${operationId}/asignar`, {
      method: "PATCH",
      body: {
        vehiculo_id: alternativeVehicle.vehiculo_id,
        conductor_id: alternativeVehicle.conductor_id,
        decision_id: recommendation.body.data.decisionId,
        decision_reason: "Se distribuye la carga de trabajo de la flota.",
      },
    });
    assert.equal(assignedAlternative.status, 200);
    assert.equal(assignedAlternative.body.data.vehiculo_id, alternativeVehicle.vehiculo_id);
    assert.equal(state.decisions[1].resultado, "alternativa");
    assert.equal(state.decisions[1].factores.decision_operador.motivo, "Se distribuye la carga de trabajo de la flota.");

    const pendingSubcontract = await request(`/api/admin/operaciones/${operationId}/subcontratacion`, {
      method: "PATCH",
      body: { estado: "pendiente", empresa: "Transportes externos" },
    });
    assert.equal(pendingSubcontract.status, 200);
    assert.equal(pendingSubcontract.body.data.subcontratacion_estado, "pendiente");
    assert.equal(pendingSubcontract.body.data.estado, "programada");
    assert.equal(state.reservations[1].vehiculo_id, null);
    assert.equal(state.reservations[1].conductor_id, null);

    const startBeforeConfirmation = await request(`/api/admin/operaciones/${operationId}/estado`, {
      method: "PATCH",
      body: { estado: "en_curso" },
    });
    assert.equal(startBeforeConfirmation.status, 403);

    const missingDetails = await request(`/api/admin/operaciones/${operationId}/subcontratacion`, {
      method: "PATCH",
      body: { estado: "confirmada", empresa: "Transportes externos" },
    });
    assert.equal(missingDetails.status, 400);
    assert.equal(operationFor(operationId).subcontratacion_estado, "pendiente");

    const confirmedSubcontract = await request(`/api/admin/operaciones/${operationId}/subcontratacion`, {
      method: "PATCH",
      body: {
        estado: "confirmada",
        empresa: "Transportes externos",
        contacto: "Contacto externo",
        telefono: "0991234567",
        vehiculo: "Van 15 pasajeros",
        placa: "ABC-1234",
        conductor: "Conductor externo",
        conductor_telefono: "0987654321",
        costo: 180,
      },
    });
    assert.equal(confirmedSubcontract.status, 200, JSON.stringify(confirmedSubcontract.body));
    assert.equal(confirmedSubcontract.body.data.estado, "asignada");
    assert.equal(confirmedSubcontract.body.data.subcontratacion_estado, "confirmada");
    assert.equal(confirmedSubcontract.body.data.vehiculo_id, null);
    assert.equal(confirmedSubcontract.body.data.subcontratista_placa, "ABC-1234");

    const removedSubcontract = await request(`/api/admin/operaciones/${operationId}/subcontratacion`, {
      method: "PATCH",
      body: { estado: "no_requerida" },
    });
    assert.equal(removedSubcontract.status, 200);
    assert.equal(removedSubcontract.body.data.estado, "programada");
    assert.equal(removedSubcontract.body.data.subcontratacion_estado, "no_requerida");
    assert.equal(removedSubcontract.body.data.subcontratista_placa, null);

    const reconfirmedSubcontract = await request(`/api/admin/operaciones/${operationId}/subcontratacion`, {
      method: "PATCH",
      body: {
        estado: "confirmada",
        empresa: "Transportes externos",
        contacto: "Contacto externo",
        telefono: "0991234567",
        vehiculo: "Van 15 pasajeros",
        placa: "ABC-1234",
        conductor: "Conductor externo",
        conductor_telefono: "0987654321",
        costo: 180,
      },
    });
    assert.equal(reconfirmedSubcontract.status, 200);

    const startedExternally = await request(`/api/admin/operaciones/${operationId}/estado`, { method: "PATCH", body: { estado: "en_curso" } });
    assert.equal(startedExternally.status, 403);
    const completedExternally = await request(`/api/admin/operaciones/${operationId}/estado`, { method: "PATCH", body: { estado: "completada" } });
    assert.equal(completedExternally.status, 403);
    assert.equal(state.reservations[1].estado, "confirmada");
  });
});
