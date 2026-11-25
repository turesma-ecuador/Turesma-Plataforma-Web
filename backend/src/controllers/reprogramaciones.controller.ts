export {};

const pool = require("../config/db");
const { crearNotificacion, notificarAdmins } = require("../config/notificaciones");

const isDate = (value: unknown) => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

const isTime = (value: unknown) => {
  if (typeof value !== "string" || !/^\d{2}:\d{2}$/.test(value)) return false;
  const [hours, minutes] = value.split(":").map(Number);
  return hours < 24 && minutes < 60;
};
const dateOnly = (value: unknown) => {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}/.exec(String(value))?.[0] || null;
};
const shiftDate = (value: string, days: number) => {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};
const dayDifference = (from: string, to: string) =>
  Math.round((new Date(`${to}T00:00:00.000Z`).getTime() - new Date(`${from}T00:00:00.000Z`).getTime()) / 86400000);
const timeMinutes = (value: unknown) => {
  if (typeof value !== "string" || !/^\d{2}:\d{2}/.test(value)) return null;
  const [hours, minutes] = value.slice(0, 5).split(":").map(Number);
  return hours < 24 && minutes < 60 ? hours * 60 + minutes : null;
};
const addMinutesToTime = (value: string | null, duration: number | null) => {
  const start = timeMinutes(value);
  if (start === null || duration === null || duration <= 0) return null;
  const end = (start + duration) % 1440;
  return `${String(Math.floor(end / 60)).padStart(2, "0")}:${String(end % 60).padStart(2, "0")}`;
};

const loadServiceOperations = async (client: any, reservationId: number, groupNumber: number | null, lock = false) => {
  const result = await client.query(
    `SELECT id, requerimiento_id, grupo_numero, unidad_numero, fecha_programada::text AS fecha_programada,
            fecha_fin_programada::text AS fecha_fin_programada, hora_inicio::text AS hora_inicio,
            hora_fin::text AS hora_fin, pasajeros, estado, vehiculo_id, conductor_id,
            vehiculo_asociado_id, subcontratacion_estado
     FROM operaciones
     WHERE reserva_id = $1 AND estado <> 'cancelada'
       AND (($2::int IS NOT NULL AND requerimiento_id IS NOT NULL AND grupo_numero = $2)
         OR ($2::int IS NULL AND requerimiento_id IS NULL))
     ORDER BY unidad_numero, id ${lock ? "FOR UPDATE" : ""}`,
    [reservationId, groupNumber]
  );
  return result.rows;
};

const scheduleAvailabilityError = async (
  client: any,
  reservation: any,
  operations: any[],
  startDate: string,
  startTime: string | null
) => {
  const reservationId = Number(reservation.reserva_id || reservation.id);
  const sourceDate = operations.length
    ? dateOnly(operations[0].fecha_programada)
    : dateOnly(reservation.fecha_salida) || dateOnly(reservation.fecha_servicio) || dateOnly(reservation.fecha_reserva);
  if (!sourceDate) return "No se pudo determinar la fecha actual del servicio.";
  const deltaDays = dayDifference(sourceDate, startDate);
  const sourceEnd = operations.length
    ? operations.reduce((latest, operation) => {
      const end = dateOnly(operation.fecha_fin_programada) || dateOnly(operation.fecha_programada) || sourceDate;
      return end > latest ? end : latest;
    }, sourceDate)
    : dateOnly(reservation.fecha_fin) || dateOnly(reservation.fecha_regreso) || dateOnly(reservation.fecha_llegada) || sourceDate;
  const endDate = shiftDate(sourceEnd, deltaDays);
  const sourceStartTime = operations[0]?.hora_inicio?.slice(0, 5)
    || reservation.reservation_start_time?.slice(0, 5)
    || null;
  const sourceEndTime = operations[0]?.hora_fin?.slice(0, 5)
    || reservation.reservation_end_time?.slice(0, 5)
    || null;
  const proposedStartTime = startTime || sourceStartTime;
  const sourceStartMinutes = timeMinutes(sourceStartTime);
  const sourceEndMinutes = timeMinutes(sourceEndTime);
  const durationMinutes = sourceStartMinutes !== null && sourceEndMinutes !== null
    ? (sourceEndMinutes - sourceStartMinutes + 1440) % 1440
    : null;
  const proposedEndTime = addMinutesToTime(proposedStartTime, durationMinutes);
  const operationIds = operations.map((operation) => Number(operation.id)).filter(Number.isInteger);
  const vehicleIds = [...new Set([
    ...operations.map((operation) => Number(operation.vehiculo_id)).filter(Number.isInteger),
    ...(!operations.length && reservation.vehiculo_id ? [Number(reservation.vehiculo_id)] : []),
  ])];
  const operationDriverIds = [...new Set(operations.map((operation) => Number(operation.conductor_id)).filter(Number.isInteger))];
  const reservationDriverIds = !operations.length && reservation.conductor_id ? [Number(reservation.conductor_id)] : [];
  const associatedIds = [...new Set(operations.map((operation) => Number(operation.vehiculo_asociado_id)).filter(Number.isInteger))];
  const requiredCapacity = operations.length
    ? Math.max(...operations.map((operation) => Number(operation.pasajeros) || 1))
    : Number(reservation.num_personas) || 1;
  const unassignedCount = operations.filter((operation) => !operation.vehiculo_id && !operation.vehiculo_asociado_id).length
    + (!operations.length && !vehicleIds.length ? 1 : 0);

  if (operations.some((operation) => operation.subcontratacion_estado === "confirmada" && !operation.vehiculo_asociado_id)) {
    return "Una unidad subcontratada no tiene vehículo asociado registrado para validar disponibilidad.";
  }

  if (operationDriverIds.length || reservationDriverIds.length) {
    const invalidDriver = await client.query(
      `SELECT c.id
       FROM conductores c JOIN usuarios u ON u.id = c.usuario_id
       WHERE (c.id = ANY($1::int[]) OR c.usuario_id = ANY($2::int[]))
         AND (u.activo IS DISTINCT FROM true OR c.estado IN ('inactivo', 'mantenimiento')
           OR (c.fecha_licencia_vencimiento IS NOT NULL AND c.fecha_licencia_vencimiento < $3::date))
       LIMIT 1`,
      [operationDriverIds, reservationDriverIds, startDate]
    );
    if (invalidDriver.rowCount) return "El conductor asignado no está habilitado para la fecha propuesta.";
  }
  if (associatedIds.length) {
    const inactiveAssociatedVehicle = await client.query(
      "SELECT id FROM vehiculos_asociados WHERE id = ANY($1::int[]) AND activo IS DISTINCT FROM true LIMIT 1",
      [associatedIds]
    );
    if (inactiveAssociatedVehicle.rowCount) return "Una unidad asociada no está activa para la fecha propuesta.";
  }

  if (vehicleIds.length) {
    const invalidVehicle = await client.query(
      `SELECT v.id
       FROM vehiculos v
       WHERE v.id = ANY($1::int[])
         AND (
           v.activo IS DISTINCT FROM true OR v.estado IS DISTINCT FROM 'disponible' OR v.capacidad < $2
           OR (v.fecha_proximo_mantenimiento IS NOT NULL AND v.fecha_proximo_mantenimiento <= $3::date)
           OR (v.proximo_km_mantenimiento IS NOT NULL AND v.proximo_km_mantenimiento <= COALESCE(v.kilometraje, 0))
           OR EXISTS (
             SELECT 1 FROM mantenimiento_vehiculos m
             WHERE m.vehiculo_id = v.id AND (m.estado = 'en_progreso'
               OR (m.estado = 'programado' AND m.fecha_programada BETWEEN $3::date AND $4::date))
           )
           OR EXISTS (
             SELECT 1 FROM vehiculo_indisponibilidades b
             WHERE b.vehiculo_id = v.id AND b.estado = 'activa'
               AND b.fecha_inicio <= $4::date AND COALESCE(b.fecha_fin, 'infinity'::date) >= $3::date
           )
           OR EXISTS (
             SELECT 1 FROM generate_series($3::date, $4::date, INTERVAL '1 day') AS series(service_day)
             LEFT JOIN vehiculo_disponibilidad vd ON vd.vehiculo_id = v.id AND vd.fecha = series.service_day::date
             WHERE vd.disponible = false
               OR (vd.disponible IS DISTINCT FROM true
                 AND NOT (EXTRACT(DOW FROM series.service_day)::int = ANY(COALESCE(v.dias_servicio, ARRAY[0,1,2,3,4,5,6]))))
           )
         )
       LIMIT 1`,
      [vehicleIds, requiredCapacity, startDate, endDate]
    );
    if (invalidVehicle.rowCount) return "Una de las unidades asignadas no está disponible en la fecha propuesta.";
  }

  const conflictingOperation = await client.query(
    `SELECT o.id
     FROM operaciones o
     WHERE o.id <> ALL($1::int[])
       AND o.estado IN ('programada', 'asignada', 'en_curso', 'incidencia')
       AND o.fecha_programada <= $3::date AND COALESCE(o.fecha_fin_programada, o.fecha_programada) >= $2::date
       AND (
         $2::date <> $3::date OR COALESCE(o.fecha_fin_programada, o.fecha_programada) <> o.fecha_programada
         OR $4::time IS NULL OR $5::time IS NULL OR o.hora_inicio IS NULL OR o.hora_fin IS NULL
         OR (o.hora_inicio < $5::time AND $4::time < o.hora_fin)
       )
       AND (
         o.vehiculo_id = ANY($6::int[]) OR o.conductor_id = ANY($7::int[])
         OR o.vehiculo_asociado_id = ANY($9::int[])
         OR EXISTS (SELECT 1 FROM conductores c WHERE c.id = o.conductor_id AND c.usuario_id = ANY($8::int[]))
       )
     LIMIT 1`,
    [operationIds, startDate, endDate, proposedStartTime, proposedEndTime, vehicleIds, operationDriverIds, reservationDriverIds, associatedIds]
  );
  if (conflictingOperation.rowCount) return "Una unidad o conductor ya tiene otro servicio en la fecha propuesta.";

  const conflictingReservation = await client.query(
    `SELECT r.id
     FROM reservas r
     WHERE r.id <> $1 AND r.estado NOT IN ('cancelada', 'finalizada')
       AND COALESCE(r.fecha_salida::date, r.fecha_servicio::date, r.fecha_reserva::date) <= $3::date
       AND COALESCE(r.fecha_fin, r.fecha_regreso, r.fecha_llegada::date, r.fecha_salida::date, r.fecha_servicio::date, r.fecha_reserva::date) >= $2::date
       AND (
         $2::date <> $3::date OR r.fecha_salida IS NULL OR r.fecha_llegada IS NULL
         OR r.fecha_salida::date <> r.fecha_llegada::date OR $4::time IS NULL OR $5::time IS NULL
         OR (r.fecha_salida::time < $5::time AND $4::time < r.fecha_llegada::time)
       )
       AND (r.vehiculo_id = ANY($6::int[]) OR r.conductor_id = ANY($7::int[])
         OR EXISTS (SELECT 1 FROM conductores c WHERE c.usuario_id = r.conductor_id AND c.id = ANY($8::int[])))
     LIMIT 1`,
    [reservationId, startDate, endDate, proposedStartTime, proposedEndTime, vehicleIds, reservationDriverIds, operationDriverIds]
  );
  if (conflictingReservation.rowCount) return "Una unidad o conductor ya está reservado en la fecha propuesta.";

  if (unassignedCount > 0) {
    const fleet = await client.query(
      `SELECT COUNT(*)::int AS total
       FROM vehiculos v
       WHERE v.activo = true AND v.estado = 'disponible' AND v.capacidad >= $1
         AND NOT EXISTS (
           SELECT 1 FROM generate_series($2::date, $3::date, INTERVAL '1 day') AS series(service_day)
           LEFT JOIN vehiculo_disponibilidad vd ON vd.vehiculo_id = v.id AND vd.fecha = series.service_day::date
           WHERE vd.disponible = false
             OR (vd.disponible IS DISTINCT FROM true
               AND NOT (EXTRACT(DOW FROM series.service_day)::int = ANY(COALESCE(v.dias_servicio, ARRAY[0,1,2,3,4,5,6]))))
         )
         AND NOT EXISTS (
           SELECT 1 FROM mantenimiento_vehiculos m
           WHERE m.vehiculo_id = v.id AND (m.estado = 'en_progreso'
             OR (m.estado = 'programado' AND m.fecha_programada BETWEEN $2::date AND $3::date))
         )
         AND NOT EXISTS (
           SELECT 1 FROM vehiculo_indisponibilidades b
           WHERE b.vehiculo_id = v.id AND b.estado = 'activa'
             AND b.fecha_inicio <= $3::date AND COALESCE(b.fecha_fin, 'infinity'::date) >= $2::date
         )
         AND NOT EXISTS (
           SELECT 1 FROM operaciones o
           WHERE o.vehiculo_id = v.id AND o.id <> ALL($5::int[])
             AND o.estado IN ('programada', 'asignada', 'en_curso', 'incidencia')
             AND o.fecha_programada <= $3::date AND COALESCE(o.fecha_fin_programada, o.fecha_programada) >= $2::date
             AND (
               $2::date <> $3::date OR COALESCE(o.fecha_fin_programada, o.fecha_programada) <> o.fecha_programada
               OR $7::time IS NULL OR $8::time IS NULL OR o.hora_inicio IS NULL OR o.hora_fin IS NULL
               OR (o.hora_inicio < $8::time AND $7::time < o.hora_fin)
             )
         )
         AND v.id <> ALL($6::int[])
         AND NOT EXISTS (
           SELECT 1 FROM reservas r
           WHERE r.id <> $4 AND r.vehiculo_id = v.id AND r.estado NOT IN ('cancelada', 'finalizada')
             AND COALESCE(r.fecha_salida::date, r.fecha_servicio::date, r.fecha_reserva::date) <= $3::date
             AND COALESCE(r.fecha_fin, r.fecha_regreso, r.fecha_llegada::date, r.fecha_salida::date, r.fecha_servicio::date, r.fecha_reserva::date) >= $2::date
             AND (
               $2::date <> $3::date OR r.fecha_salida IS NULL OR r.fecha_llegada IS NULL
               OR r.fecha_salida::date <> r.fecha_llegada::date OR $7::time IS NULL OR $8::time IS NULL
               OR (r.fecha_salida::time < $8::time AND $7::time < r.fecha_llegada::time)
             )
         )`,
      [requiredCapacity, startDate, endDate, reservationId, operationIds, vehicleIds, proposedStartTime, proposedEndTime]
    );
    if (Number(fleet.rows[0]?.total || 0) < unassignedCount) {
      return "No hay suficientes unidades disponibles para todas las unidades del grupo en la fecha propuesta.";
    }
  }

  return null;
};

const crearSolicitudReprogramacion = async (req: any, res: any) => {
  const reservaId = Number(req.params.id);
  const userId = Number(req.user?.id);
  const grupoNumero = req.body?.grupo_numero == null || req.body?.grupo_numero === ""
    ? null
    : Number(req.body.grupo_numero);
  const fecha = typeof req.body?.fecha === "string" ? req.body.fecha.trim() : "";
  const hora = typeof req.body?.hora === "string" ? req.body.hora.trim() : "";
  if (!Number.isInteger(reservaId) || reservaId <= 0 || !Number.isInteger(userId) || userId <= 0) {
    return res.status(400).json({ error: "Reserva o usuario inválido" });
  }
  if (grupoNumero !== null && (!Number.isInteger(grupoNumero) || grupoNumero < 1)) {
    return res.status(400).json({ error: "Grupo inválido" });
  }
  if (!isDate(fecha) || (hora && !isTime(hora)) || fecha < new Date().toISOString().slice(0, 10)) {
    return res.status(400).json({ error: "Indica una fecha y hora válidas, no anteriores a hoy" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const reservationResult = await client.query(
      `SELECT id, usuario_id, estado, estado_pago, monto_pagado, total, fecha_reserva::text AS fecha_reserva,
              fecha_salida, fecha_servicio, fecha_fin::text AS fecha_fin, fecha_regreso::text AS fecha_regreso,
              hora_salida, num_personas, vehiculo_id, conductor_id, estado_operativo, recogido
       FROM reservas WHERE id = $1 AND usuario_id = $2 FOR UPDATE`,
      [reservaId, userId]
    );
    if (!reservationResult.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Reserva no encontrada" });
    }
    const reservation = reservationResult.rows[0];
    if (reservation.estado !== "confirmada") {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Solo puedes solicitar cambios en una reserva confirmada" });
    }
    if (reservation.estado_operativo === "en_curso" || reservation.recogido) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "El viaje ya comenzó y no se puede reprogramar desde aquí" });
    }
    const operations = await loadServiceOperations(client, reservaId, grupoNumero, true);
    if (grupoNumero !== null && !operations.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "No se encontró el grupo de servicio solicitado" });
    }
    if (operations.some((operation: any) => ["en_curso", "completada"].includes(operation.estado))) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Este grupo ya comenzó o fue completado y no se puede reprogramar" });
    }
    const oldDate = dateOnly(operations[0]?.fecha_programada)
      || dateOnly(reservation.fecha_salida) || dateOnly(reservation.fecha_servicio) || dateOnly(reservation.fecha_reserva);
    const oldTime = operations[0]?.hora_inicio?.slice(0, 5) || reservation.hora_salida?.slice(0, 5) || null;
    if (!oldDate) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "No se pudo determinar la fecha actual del servicio" });
    }
    if (oldDate === fecha && (!hora || hora === oldTime)) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "La nueva fecha u hora debe ser diferente a la actual" });
    }
    const duplicate = await client.query(
      `SELECT id FROM solicitudes_reprogramacion
       WHERE reserva_id = $1 AND grupo_numero IS NOT DISTINCT FROM $2
         AND estado IN ('pendiente_admin', 'propuesta_cliente')
       LIMIT 1`,
      [reservaId, grupoNumero]
    );
    if (duplicate.rowCount) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Ya existe una solicitud de cambio pendiente para este servicio" });
    }
    const inserted = await client.query(
      `INSERT INTO solicitudes_reprogramacion
         (reserva_id, usuario_id, grupo_numero, fecha_anterior, hora_anterior, fecha_solicitada, hora_solicitada)
       VALUES ($1, $2, $3, $4, $5, $6, NULLIF($7, '')::time)
       RETURNING id, reserva_id, grupo_numero, estado, fecha_anterior, hora_anterior,
                 fecha_solicitada, hora_solicitada, creado_en`,
      [reservaId, userId, grupoNumero, oldDate, oldTime, fecha, hora]
    );
    await client.query(
      `INSERT INTO reserva_historial (reserva_id, usuario_id, accion, estado_anterior, estado_nuevo, detalle)
       VALUES ($1, $2, 'solicitud_reprogramacion_cliente', 'confirmada', 'confirmada', $3::jsonb)`,
      [reservaId, userId, JSON.stringify({
        solicitud_id: inserted.rows[0].id,
        grupo_numero: grupoNumero,
        fecha_anterior: oldDate,
        hora_anterior: oldTime,
        fecha_solicitada: fecha,
        hora_solicitada: hora || oldTime,
      })]
    );
    await client.query("COMMIT");
    await notificarAdmins(userId, `El cliente solicitó cambiar la fecha del servicio${grupoNumero ? ` del grupo ${grupoNumero}` : ""} de la reserva #${reservaId}.`, "reserva", reservaId);
    return res.status(201).json({
      message: "Solicitud enviada. La fecha actual se mantiene hasta que aceptes una propuesta.",
      data: inserted.rows[0],
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error creando solicitud de reprogramación:", error);
    return res.status(500).json({ error: "No se pudo enviar la solicitud" });
  } finally {
    client.release();
  }
};

const listarSolicitudesReprogramacionAdmin = async (_req: any, res: any) => {
  try {
    const result = await pool.query(
      `SELECT s.*, u.nombre AS cliente_nombre, u.email AS cliente_email,
              r.origen, r.destino, r.estado AS reserva_estado, r.estado_pago, r.monto_pagado,
              COALESCE(
                json_agg(json_build_object(
                  'id', o.id, 'estado', o.estado, 'vehiculo_id', o.vehiculo_id,
                  'vehiculo_asociado_id', o.vehiculo_asociado_id, 'conductor_id', o.conductor_id
                ) ORDER BY o.unidad_numero) FILTER (WHERE o.id IS NOT NULL),
                '[]'::json
              ) AS operaciones
       FROM solicitudes_reprogramacion s
       JOIN reservas r ON r.id = s.reserva_id
       JOIN usuarios u ON u.id = s.usuario_id
       LEFT JOIN operaciones o ON o.reserva_id = s.reserva_id
         AND o.estado <> 'cancelada'
         AND ((s.grupo_numero IS NOT NULL AND o.requerimiento_id IS NOT NULL AND o.grupo_numero = s.grupo_numero)
           OR (s.grupo_numero IS NULL AND o.requerimiento_id IS NULL))
       WHERE s.estado IN ('pendiente_admin', 'propuesta_cliente')
       GROUP BY s.id, u.nombre, u.email, r.origen, r.destino, r.estado, r.estado_pago, r.monto_pagado
       ORDER BY s.creado_en ASC, s.id ASC`
    );
    return res.json(result.rows);
  } catch (error) {
    console.error("Error listando solicitudes de reprogramación:", error);
    return res.status(500).json({ error: "No se pudieron cargar las solicitudes" });
  }
};

const listarSolicitudesReprogramacionCliente = async (req: any, res: any) => {
  const reservaId = Number(req.params.id);
  const userId = Number(req.user?.id);
  if (!Number.isInteger(reservaId) || reservaId <= 0 || !Number.isInteger(userId) || userId <= 0) {
    return res.status(400).json({ error: "Reserva o usuario inválido" });
  }
  try {
    const result = await pool.query(
      `SELECT s.* FROM solicitudes_reprogramacion s
       JOIN reservas r ON r.id = s.reserva_id
       WHERE s.reserva_id = $1 AND r.usuario_id = $2
       ORDER BY s.creado_en DESC, s.id DESC`,
      [reservaId, userId]
    );
    return res.json(result.rows);
  } catch (error) {
    console.error("Error consultando solicitudes de reprogramación:", error);
    return res.status(500).json({ error: "No se pudieron consultar las solicitudes" });
  }
};

const proponerReprogramacion = async (req: any, res: any) => {
  const requestId = Number(req.params.solicitudId);
  const fecha = typeof req.body?.fecha_propuesta === "string" ? req.body.fecha_propuesta.trim() : "";
  const hora = typeof req.body?.hora_propuesta === "string" ? req.body.hora_propuesta.trim() : "";
  const note = typeof req.body?.nota_admin === "string" ? req.body.nota_admin.trim() : "";
  if (!Number.isInteger(requestId) || requestId <= 0 || !isDate(fecha) || (hora && !isTime(hora))
    || fecha < new Date().toISOString().slice(0, 10) || note.length < 5 || note.length > 500) {
    return res.status(400).json({ error: "Indica una fecha disponible, hora válida y una nota de al menos 5 caracteres" });
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const requestResult = await client.query(
      `SELECT s.*, r.id AS reserva_id, r.estado AS reserva_estado, r.estado_pago, r.total, r.monto_pagado,
              r.estado_operativo, r.recogido, r.fecha_reserva::text AS fecha_reserva,
              r.fecha_salida, r.fecha_servicio, r.fecha_fin::text AS fecha_fin,
              r.fecha_regreso::text AS fecha_regreso, r.fecha_llegada,
              to_char(r.fecha_salida, 'HH24:MI') AS reservation_start_time,
              to_char(r.fecha_llegada, 'HH24:MI') AS reservation_end_time,
              r.hora_salida, r.num_personas,
              r.vehiculo_id, r.conductor_id
       FROM solicitudes_reprogramacion s JOIN reservas r ON r.id = s.reserva_id
       WHERE s.id = $1 FOR UPDATE OF s, r`,
      [requestId]
    );
    if (!requestResult.rowCount || requestResult.rows[0].estado !== "pendiente_admin") {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "La solicitud ya fue atendida o no existe" });
    }
    const item = requestResult.rows[0];
    if (item.reserva_estado !== "confirmada" || item.estado_operativo === "en_curso" || item.recogido) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "La reserva ya no está habilitada para reprogramar" });
    }
    const operations = await loadServiceOperations(client, Number(item.reserva_id), item.grupo_numero, true);
    if (operations.some((operation: any) => ["en_curso", "completada"].includes(operation.estado))) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "El servicio ya comenzó y no se puede reprogramar" });
    }
    const availabilityError = await scheduleAvailabilityError(client, item, operations, fecha, hora || null);
    if (availabilityError) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: `${availabilityError} Elige otra fecha u hora.` });
    }
    await client.query(
      `UPDATE solicitudes_reprogramacion
       SET estado = 'propuesta_cliente', fecha_propuesta = $1, hora_propuesta = NULLIF($2, '')::time,
           nota_admin = $3, respondido_por = $4, actualizado_en = NOW()
       WHERE id = $5`,
      [fecha, hora, note, req.user?.id || null, requestId]
    );
    await client.query(
      `INSERT INTO reserva_historial (reserva_id, usuario_id, accion, estado_anterior, estado_nuevo, detalle)
       VALUES ($1, $2, 'propuesta_reprogramacion_enviada', 'confirmada', 'confirmada', $3::jsonb)`,
      [item.reserva_id, req.user?.id || null, JSON.stringify({
        solicitud_id: item.id,
        grupo_numero: item.grupo_numero,
        fecha_propuesta: fecha,
        hora_propuesta: hora || null,
        nota_admin: note,
      })]
    );
    await client.query("COMMIT");
    await crearNotificacion(req.user?.id, item.usuario_id,
      `Turesma envió una alternativa de fecha para el servicio${item.grupo_numero ? ` del grupo ${item.grupo_numero}` : ""} de la reserva #${item.reserva_id}.`,
      Number(item.reserva_id), "reserva", Number(item.reserva_id),
      `Turesma sent an alternative date for the service${item.grupo_numero ? ` in group ${item.grupo_numero}` : ""} on reservation #${item.reserva_id}.`);
    return res.json({ message: "Alternativa enviada al cliente" });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error proponiendo reprogramación:", error);
    return res.status(500).json({ error: "No se pudo enviar la alternativa" });
  } finally {
    client.release();
  }
};

const rechazarSolicitudReprogramacion = async (req: any, res: any) => {
  const requestId = Number(req.params.solicitudId);
  const note = typeof req.body?.nota_admin === "string" ? req.body.nota_admin.trim() : "";
  if (!Number.isInteger(requestId) || requestId <= 0 || note.length < 5 || note.length > 500) {
    return res.status(400).json({ error: "Indica un motivo de al menos 5 caracteres" });
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `UPDATE solicitudes_reprogramacion
       SET estado = 'rechazada_admin', nota_admin = $1, respondido_por = $2, actualizado_en = NOW()
       WHERE id = $3 AND estado = 'pendiente_admin'
       RETURNING id, reserva_id, usuario_id, grupo_numero`,
      [note, req.user?.id || null, requestId]
    );
    if (!result.rowCount) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "La solicitud ya fue atendida o no existe" });
    }
    const item = result.rows[0];
    await client.query(
      `INSERT INTO reserva_historial (reserva_id, usuario_id, accion, estado_anterior, estado_nuevo, detalle)
       VALUES ($1, $2, 'solicitud_reprogramacion_rechazada', 'confirmada', 'confirmada', $3::jsonb)`,
      [item.reserva_id, req.user?.id || null, JSON.stringify({ solicitud_id: item.id, grupo_numero: item.grupo_numero, nota_admin: note })]
    );
    await client.query("COMMIT");
    await crearNotificacion(req.user?.id, item.usuario_id,
      `La solicitud de cambio de fecha${item.grupo_numero ? ` del grupo ${item.grupo_numero}` : ""} de la reserva #${item.reserva_id} no está disponible. La reserva conserva su fecha original. ${note}`,
      Number(item.reserva_id), "reserva", Number(item.reserva_id),
      `The date change request${item.grupo_numero ? ` for group ${item.grupo_numero}` : ""} on reservation #${item.reserva_id} isn't available. The reservation keeps its original date. ${note}`);
    return res.json({ message: "Solicitud respondida; la fecha original se mantiene" });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error rechazando solicitud de reprogramación:", error);
    return res.status(500).json({ error: "No se pudo responder la solicitud" });
  } finally {
    client.release();
  }
};

const rechazarPropuestaReprogramacion = async (req: any, res: any) => {
  const requestId = Number(req.params.solicitudId);
  const userId = Number(req.user?.id);
  if (!Number.isInteger(requestId) || requestId <= 0 || !Number.isInteger(userId) || userId <= 0) {
    return res.status(400).json({ error: "Solicitud o usuario inválido" });
  }
  try {
    const result = await pool.query(
      `UPDATE solicitudes_reprogramacion s
       SET estado = 'rechazada_cliente', actualizado_en = NOW()
       FROM reservas r
       WHERE s.id = $1 AND s.usuario_id = $2 AND s.estado = 'propuesta_cliente'
         AND r.id = s.reserva_id AND r.usuario_id = $2
       RETURNING s.id, s.reserva_id, s.grupo_numero`,
      [requestId, userId]
    );
    if (!result.rowCount) return res.status(409).json({ error: "La alternativa ya no está disponible" });
    const item = result.rows[0];
    await notificarAdmins(userId, `El cliente rechazó la alternativa de fecha de la reserva #${item.reserva_id}. La fecha original se mantiene.`, "reserva", Number(item.reserva_id));
    return res.json({ message: "Alternativa rechazada. La fecha original se mantiene." });
  } catch (error) {
    console.error("Error rechazando alternativa de reprogramación:", error);
    return res.status(500).json({ error: "No se pudo rechazar la alternativa" });
  }
};

const aceptarPropuestaReprogramacion = async (req: any, res: any) => {
  const requestId = Number(req.params.solicitudId);
  const userId = Number(req.user?.id);
  if (!Number.isInteger(requestId) || requestId <= 0 || !Number.isInteger(userId) || userId <= 0) {
    return res.status(400).json({ error: "Solicitud o usuario inválido" });
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const requestResult = await client.query(
      `SELECT s.*, r.estado AS reserva_estado, r.estado_pago, r.total, r.monto_pagado,
              r.id AS reserva_id, r.estado_operativo, r.recogido, r.fecha_reserva::text AS fecha_reserva,
              r.fecha_salida, r.fecha_servicio, r.fecha_fin::text AS fecha_fin,
              r.fecha_regreso::text AS fecha_regreso, r.fecha_llegada,
              to_char(r.fecha_salida, 'HH24:MI') AS reservation_start_time,
              to_char(r.fecha_llegada, 'HH24:MI') AS reservation_end_time,
              r.hora_salida, r.num_personas,
              r.vehiculo_id, r.conductor_id, r.origen, r.destino
       FROM solicitudes_reprogramacion s JOIN reservas r ON r.id = s.reserva_id
       WHERE s.id = $1 AND s.usuario_id = $2
       FOR UPDATE OF s, r`,
      [requestId, userId]
    );
    if (!requestResult.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Alternativa no encontrada" });
    }
    const request = requestResult.rows[0];
    if (request.estado !== "propuesta_cliente") {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "La alternativa ya no está disponible" });
    }
    if (request.reserva_estado !== "confirmada" || request.estado_operativo === "en_curso" || request.recogido) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "La reserva ya no está habilitada para cambiar su fecha; conserva la original y contacta a Turesma" });
    }
    const operations = await loadServiceOperations(client, Number(request.reserva_id), request.grupo_numero, true);
    if (operations.some((operation: any) => ["en_curso", "completada"].includes(operation.estado))) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "El servicio ya comenzó y no se puede reprogramar" });
    }
    const availabilityError = await scheduleAvailabilityError(
      client,
      request,
      operations,
      dateOnly(request.fecha_propuesta),
      request.hora_propuesta?.slice(0, 5) || null
    );
    if (availabilityError) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: `${availabilityError} La fecha original se mantiene.` });
    }
    const oldDate = dateOnly(operations[0]?.fecha_programada)
      || dateOnly(request.fecha_salida) || dateOnly(request.fecha_servicio) || dateOnly(request.fecha_reserva);
    if (!oldDate) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "No se pudo determinar la fecha original del servicio" });
    }
    const deltaDays = dayDifference(oldDate, dateOnly(request.fecha_propuesta));
    const oldEnd = operations.length
      ? operations.reduce((latest: string, operation: any) => {
        const end = dateOnly(operation.fecha_fin_programada) || dateOnly(operation.fecha_programada) || oldDate;
        return end > latest ? end : latest;
      }, oldDate)
      : dateOnly(request.fecha_fin) || dateOnly(request.fecha_regreso) || dateOnly(request.fecha_llegada) || oldDate;
    const newEnd = shiftDate(oldEnd, deltaDays);
    if (request.grupo_numero == null) {
      await client.query(
        `UPDATE reservas
         SET fecha_fin = CASE WHEN fecha_fin IS NOT NULL THEN fecha_fin + ($1::date - $2::date) ELSE NULL END,
             fecha_regreso = CASE WHEN fecha_regreso IS NOT NULL THEN fecha_regreso + ($1::date - $2::date) ELSE NULL END,
             fecha_salida = CASE WHEN fecha_salida IS NOT NULL THEN $1::date + COALESCE(NULLIF($3, '')::time, fecha_salida::time) ELSE NULL END,
             fecha_llegada = CASE WHEN fecha_llegada IS NOT NULL THEN
               fecha_llegada + (($1::date - $2::date) * INTERVAL '1 day')
               + CASE WHEN NULLIF($3, '') IS NOT NULL AND fecha_salida IS NOT NULL
                   THEN ($3::time - fecha_salida::time) ELSE INTERVAL '0' END
               ELSE NULL END,
             fecha_servicio = CASE WHEN fecha_servicio IS NOT NULL THEN $1::date + COALESCE(NULLIF($3, '')::time, fecha_servicio::time) ELSE NULL END,
             fecha_reserva = $1,
             hora_salida = COALESCE(NULLIF($3, ''), hora_salida)
         WHERE id = $4`,
        [dateOnly(request.fecha_propuesta), oldDate, request.hora_propuesta || "", request.reserva_id]
      );
      await client.query(
        `UPDATE cotizaciones
         SET fecha_fin = CASE WHEN fecha_fin IS NOT NULL THEN fecha_fin + ($1::date - fecha_servicio) ELSE NULL END,
             fecha_regreso = CASE WHEN fecha_regreso IS NOT NULL THEN fecha_regreso + ($1::date - fecha_servicio) ELSE NULL END,
             fecha_servicio = $1,
             hora_salida = COALESCE(NULLIF($2, ''), hora_salida)
         WHERE reserva_id = $3`,
        [dateOnly(request.fecha_propuesta), request.hora_propuesta || "", request.reserva_id]
      );
    }
    for (const operation of operations) {
      const durationMinutes = operation.hora_inicio && operation.hora_fin
        ? (() => {
          const [startHour, startMinute] = operation.hora_inicio.slice(0, 5).split(":").map(Number);
          const [endHour, endMinute] = operation.hora_fin.slice(0, 5).split(":").map(Number);
          return endHour * 60 + endMinute - (startHour * 60 + startMinute);
        })()
        : null;
      const proposedTime = request.hora_propuesta?.slice(0, 5) || operation.hora_inicio?.slice(0, 5) || "";
      const endMinutes = durationMinutes > 0 && proposedTime
        ? (Number(proposedTime.slice(0, 2)) * 60 + Number(proposedTime.slice(3, 5)) + durationMinutes) % 1440
        : null;
      const endTime = endMinutes === null
        ? ""
        : `${String(Math.floor(endMinutes / 60)).padStart(2, "0")}:${String(endMinutes % 60).padStart(2, "0")}`;
      await client.query(
        `UPDATE operaciones
         SET fecha_programada = fecha_programada + ($1::date - $2::date),
             fecha_fin_programada = CASE WHEN fecha_fin_programada IS NOT NULL
               THEN fecha_fin_programada + ($1::date - $2::date) ELSE NULL END,
             hora_inicio = COALESCE(NULLIF($3, '')::time, hora_inicio),
             hora_fin = COALESCE(NULLIF($4, '')::time, hora_fin),
             actualizado_en = CURRENT_TIMESTAMP
         WHERE id = $5`,
        [dateOnly(request.fecha_propuesta), oldDate, request.hora_propuesta || "", endTime, operation.id]
      );
      await client.query(
        `INSERT INTO operacion_historial (operacion_id, usuario_id, accion, estado_anterior, estado_nuevo, detalle)
         VALUES ($1, $2, 'reprogramacion_cliente', $3, $3, $4::jsonb)`,
        [
          operation.id,
          userId,
          operation.estado,
          JSON.stringify({
            grupo_numero: request.grupo_numero,
            fecha_anterior: dateOnly(operation.fecha_programada),
            fecha_nueva: shiftDate(dateOnly(operation.fecha_programada) || oldDate, deltaDays),
            hora_inicio_anterior: operation.hora_inicio || null,
            hora_inicio_nueva: request.hora_propuesta || operation.hora_inicio || null,
          }),
        ]
      );
    }
    if (request.grupo_numero != null && operations[0]?.requerimiento_id) {
      await client.query(
        `UPDATE requerimientos_personalizados r
         SET service_groups = (
           SELECT jsonb_agg(
             CASE WHEN item.ordinality = $2 THEN
               jsonb_set(
                 jsonb_set(
                   jsonb_set(item.group_data, '{fecha_servicio}', to_jsonb($3::text), true),
                   '{hora_salida}', COALESCE(to_jsonb(NULLIF($4, '')::text), 'null'::jsonb), true
                 ),
                 '{fecha_fin}',
                 CASE WHEN item.group_data->>'fecha_fin' IS NULL THEN 'null'::jsonb
                   ELSE to_jsonb(((item.group_data->>'fecha_fin')::date + $5::int)::text) END,
                 true
               )
             ELSE item.group_data END
             ORDER BY item.ordinality
           )
           FROM jsonb_array_elements(r.service_groups) WITH ORDINALITY AS item(group_data, ordinality)
         )
         WHERE r.id = $1`,
        [
          operations[0].requerimiento_id,
          Number(request.grupo_numero),
          dateOnly(request.fecha_propuesta),
          request.hora_propuesta?.slice(0, 5) || operations[0].hora_inicio?.slice(0, 5) || request.hora_anterior?.slice(0, 5) || "",
          deltaDays,
        ]
      );
    }
    await client.query(
      `UPDATE solicitudes_reprogramacion
       SET estado = 'aplicada', actualizado_en = NOW()
       WHERE id = $1 AND estado = 'propuesta_cliente'`,
      [requestId]
    );
    await client.query(
      `INSERT INTO reserva_historial (reserva_id, usuario_id, accion, estado_anterior, estado_nuevo, detalle)
       VALUES ($1, $2, 'reprogramacion_cliente', 'confirmada', 'confirmada', $3::jsonb)`,
      [request.reserva_id, userId, JSON.stringify({
        solicitud_id: requestId,
        grupo_numero: request.grupo_numero,
        fecha_anterior: oldDate,
        fecha_nueva: dateOnly(request.fecha_propuesta),
        fecha_fin_anterior: oldEnd,
        fecha_fin_nueva: newEnd,
        hora_anterior: operations[0]?.hora_inicio || request.hora_anterior || null,
        hora_nueva: request.hora_propuesta || operations[0]?.hora_inicio || null,
      })]
    );
    const assignedDrivers = operations.length
      ? await client.query(
        `SELECT DISTINCT c.usuario_id
         FROM operaciones o JOIN conductores c ON c.id = o.conductor_id
         WHERE o.id = ANY($1::int[]) AND c.usuario_id IS NOT NULL`,
        [operations.map((operation: any) => Number(operation.id))]
      )
      : { rows: request.conductor_id ? [{ usuario_id: Number(request.conductor_id) }] : [] };
    await client.query("COMMIT");
    await notificarAdmins(userId, `El cliente aceptó la nueva fecha${request.grupo_numero ? ` del grupo ${request.grupo_numero}` : ""} para la reserva #${request.reserva_id}.`, "reserva", Number(request.reserva_id));
    for (const driver of assignedDrivers.rows) {
      await crearNotificacion(
        userId,
        Number(driver.usuario_id),
        `La fecha del servicio${request.grupo_numero ? ` del grupo ${request.grupo_numero}` : ""} de la reserva #${request.reserva_id} fue actualizada. Revisa tu agenda.`,
        Number(request.reserva_id),
        "reserva",
        Number(request.reserva_id)
      );
    }
    return res.json({ message: "Cambio aceptado. La fecha propuesta quedó aplicada al servicio seleccionado." });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error aplicando propuesta de reprogramación:", error);
    return res.status(500).json({ error: "No se pudo aplicar la nueva fecha" });
  } finally {
    client.release();
  }
};

module.exports = {
  crearSolicitudReprogramacion,
  listarSolicitudesReprogramacionCliente,
  listarSolicitudesReprogramacionAdmin,
  proponerReprogramacion,
  rechazarSolicitudReprogramacion,
  aceptarPropuestaReprogramacion,
  rechazarPropuestaReprogramacion,
};
