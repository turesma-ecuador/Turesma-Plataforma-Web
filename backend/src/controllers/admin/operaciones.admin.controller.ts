export {};

const pool = require("../../config/db");

const ACTIVE_STATES = ["programada", "asignada", "en_curso", "incidencia"];
const VALID_STATES = ["programada", "asignada", "en_curso", "completada", "cancelada", "incidencia"];
const VALID_SUBCONTRACTING_STATES = ["no_requerida", "pendiente", "confirmada"];

const numberOrNull = (value: unknown) => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const dateOrNull = (value: unknown) => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  return value;
};

const timeOrNull = (value: unknown) => {
  if (value === null || value === undefined || value === "") return null;
  return typeof value === "string" && /^\d{2}:\d{2}(:\d{2})?$/.test(value) ? value : null;
};

const textOrNull = (value: unknown, maxLength: number) => {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text && text.length <= maxLength ? text : null;
};

const hasInvalidText = (value: unknown, maxLength: number) =>
  value !== null && value !== undefined && value !== ""
  && (typeof value !== "string" || value.trim().length > maxLength);

const recordHistory = async (client: any, operationId: number, userId: number | null, action: string, oldState: string | null, newState: string | null, detail: Record<string, unknown> = {}) => {
  await client.query(
    `INSERT INTO operacion_historial (operacion_id, usuario_id, accion, estado_anterior, estado_nuevo, detalle)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
    [operationId, userId, action, oldState, newState, JSON.stringify(detail)]
  );
};

const findScheduleConflict = async (client: any, operationId: number, date: string, endDate: string, start: string | null, end: string | null, vehicleId: number | null, driverId: number | null, driverUserId: number | null) => {
  if (!vehicleId && !driverId) return null;

  const result = await client.query(
    `SELECT o.id, o.vehiculo_id, o.conductor_id, v.placa, u.nombre AS conductor_nombre
     FROM operaciones o
     LEFT JOIN vehiculos v ON v.id = o.vehiculo_id
     LEFT JOIN conductores c ON c.id = o.conductor_id
     LEFT JOIN usuarios u ON u.id = c.usuario_id
     WHERE o.id <> $1
       AND o.fecha_programada <= $3::date
       AND COALESCE(o.fecha_fin_programada, o.fecha_programada) >= $2::date
       AND o.estado = ANY($6::text[])
       AND (o.vehiculo_id = $7 OR o.conductor_id = $8)
       AND (
         $2::date <> $3::date
         OR COALESCE(o.fecha_fin_programada, o.fecha_programada) <> o.fecha_programada
         OR $4::time IS NULL OR o.hora_inicio IS NULL OR $5::time IS NULL OR o.hora_fin IS NULL
         OR (o.hora_inicio < $5::time AND $4::time < o.hora_fin)
       )
     LIMIT 1`,
    [operationId, date, endDate, start, end, ACTIVE_STATES, vehicleId, driverId]
  );

  if (result.rows[0]) return result.rows[0];

  const reservationConflict = await client.query(
    `SELECT r.id AS reserva_id, r.vehiculo_id, v.placa
     FROM reservas r
     LEFT JOIN vehiculos v ON v.id = r.vehiculo_id
     WHERE r.id <> COALESCE((SELECT reserva_id FROM operaciones WHERE id = $1), -1)
       AND (
         COALESCE(r.fecha_salida::date, r.fecha_servicio::date, r.fecha_reserva::date) <= $3::date
         AND COALESCE(r.fecha_fin, r.fecha_regreso, r.fecha_salida::date, r.fecha_servicio::date, r.fecha_reserva::date) >= $2::date
       )
       AND r.estado NOT IN ('cancelada', 'finalizada')
       AND (
         r.vehiculo_id = $7
         OR r.conductor_id = CASE
           WHEN EXISTS (
             SELECT 1
             FROM information_schema.table_constraints tc
             INNER JOIN information_schema.key_column_usage kcu
               ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
             INNER JOIN information_schema.constraint_column_usage ccu
               ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
             WHERE tc.table_schema = 'public' AND tc.table_name = 'reservas'
               AND tc.constraint_type = 'FOREIGN KEY' AND kcu.column_name = 'conductor_id'
               AND ccu.table_name = 'conductores'
           ) THEN $9 ELSE $8
         END
       )
       AND (
         $2::date <> $3::date
         OR COALESCE(r.fecha_fin, r.fecha_regreso, r.fecha_salida::date, r.fecha_servicio::date, r.fecha_reserva::date)
              <> COALESCE(r.fecha_salida::date, r.fecha_servicio::date, r.fecha_reserva::date)
         OR $4::time IS NULL OR r.fecha_salida IS NULL OR $5::time IS NULL OR r.fecha_llegada IS NULL
         OR (r.fecha_salida::time < $5::time AND $4::time < r.fecha_llegada::time)
       )
     LIMIT 1`,
    [operationId, date, endDate, start, end, ACTIVE_STATES, vehicleId, driverUserId, driverId]
  );

  return reservationConflict.rows[0] || null;
};

const getOperation = async (client: any, id: number) => {
  const result = await client.query(
    `SELECT o.*, v.placa AS vehiculo_placa, v.modelo AS vehiculo_modelo,
            u.id AS conductor_usuario_id,
            u.nombre AS conductor_nombre, u.apellido AS conductor_apellido
     FROM operaciones o
     LEFT JOIN vehiculos v ON v.id = o.vehiculo_id
     LEFT JOIN conductores c ON c.id = o.conductor_id
     LEFT JOIN usuarios u ON u.id = c.usuario_id
     WHERE o.id = $1`,
    [id]
  );
  return result.rows[0] || null;
};

const listarOperaciones = async (req: any, res: any) => {
  try {
    const { desde, hasta, estado } = req.query;
    const params: unknown[] = [];
    const filters = ["1=1"];

    if (desde) {
      params.push(desde);
    filters.push(`COALESCE(o.fecha_fin_programada, o.fecha_programada) >= $${params.length}::date`);
    }
    if (hasta) {
      params.push(hasta);
      filters.push(`o.fecha_programada <= $${params.length}::date`);
    }
    if (estado && VALID_STATES.includes(String(estado))) {
      params.push(estado);
      filters.push(`o.estado = $${params.length}`);
    }

    const result = await pool.query(
      `SELECT o.*, v.placa AS vehiculo_placa, v.modelo AS vehiculo_modelo,
              u.id AS conductor_usuario_id,
              u.nombre AS conductor_nombre, u.apellido AS conductor_apellido
       FROM operaciones o
       LEFT JOIN vehiculos v ON v.id = o.vehiculo_id
       LEFT JOIN conductores c ON c.id = o.conductor_id
       LEFT JOIN usuarios u ON u.id = c.usuario_id
       WHERE ${filters.join(" AND ")}
       ORDER BY o.fecha_programada ASC, o.hora_inicio ASC NULLS LAST, o.id DESC
       LIMIT 500`,
      params
    );

    return res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error("Error listando operaciones:", error);
    return res.status(500).json({ success: false, error: "No se pudieron cargar las operaciones" });
  }
};

const listarReservasPorDespachar = async (_req: any, res: any) => {
  try {
    const result = await pool.query(
      `SELECT r.id, r.fecha_reserva, r.fecha_servicio, r.fecha_salida, r.fecha_llegada,
              r.origen, r.destino, r.num_personas, r.total, r.vehiculo_id, r.tipo_vehiculo, r.conductor_id,
              r.estado_operativo,
              u.nombre AS cliente_nombre, v.placa AS vehiculo_placa,
              (SELECT o.id FROM operaciones o
               WHERE o.reserva_id = r.id AND o.estado = 'cancelada'
               ORDER BY o.id DESC LIMIT 1) AS operacion_cancelada_id
       FROM reservas r
       LEFT JOIN usuarios u ON u.id = r.usuario_id
       LEFT JOIN vehiculos v ON v.id = r.vehiculo_id
       WHERE r.estado = 'confirmada'
          AND COALESCE(r.estado_operativo, '') <> 'en_curso'
          AND NOT EXISTS (
            SELECT 1 FROM requerimientos_personalizados rp WHERE rp.reserva_id = r.id
          )
          AND (
            EXISTS (SELECT 1 FROM operaciones o WHERE o.reserva_id = r.id AND o.estado = 'cancelada')
            OR NOT EXISTS (SELECT 1 FROM operaciones o WHERE o.reserva_id = r.id)
          )
          AND NOT EXISTS (
           SELECT 1 FROM operaciones o
           WHERE o.reserva_id = r.id AND o.estado <> 'cancelada'
         )
       ORDER BY COALESCE(r.fecha_salida::date, r.fecha_servicio::date, r.fecha_reserva) ASC, r.id ASC
       LIMIT 200`
    );
    return res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error("Error listando reservas pendientes de despacho:", error);
    return res.status(500).json({ success: false, error: "No se pudieron cargar las reservas por despachar" });
  }
};

const crearOperacionDesdeReserva = async (req: any, res: any) => {
  const reservationId = Number(req.params.id);
  if (!Number.isInteger(reservationId) || reservationId <= 0) {
    return res.status(400).json({ success: false, error: "ID de reserva inválido" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const reservation = await client.query(
      `SELECT id, fecha_reserva, fecha_servicio, fecha_salida, fecha_llegada, fecha_fin, fecha_regreso,
              origen, destino, num_personas, estado, estado_operativo, vehiculo_id, conductor_id
       FROM reservas WHERE id = $1 FOR UPDATE`,
      [reservationId]
    );
    if (!reservation.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ success: false, error: "Reserva no encontrada" });
    }

    const current = reservation.rows[0];
    if (current.estado !== "confirmada") {
      await client.query("ROLLBACK");
      return res.status(409).json({ success: false, error: "La reserva ya no está pendiente de despacho" });
    }
    if (current.estado_operativo === "en_curso" || current.estado_operativo === "finalizada") {
      await client.query("ROLLBACK");
      return res.status(409).json({ success: false, error: "El viaje ya comenzó o terminó; no se puede volver a preparar desde Despacho" });
    }

    const existing = await client.query("SELECT id FROM operaciones WHERE reserva_id = $1 LIMIT 1", [reservationId]);
    if (existing.rowCount) {
      await client.query("ROLLBACK");
      return res.status(409).json({ success: false, error: "La reserva ya tiene una operación de despacho" });
    }

    const assignedDriver = current.conductor_id
      ? await client.query(
        `SELECT id
         FROM conductores
         WHERE id = $1 OR usuario_id = $1
         ORDER BY CASE WHEN id = $1 THEN 0 ELSE 1 END
         LIMIT 1`,
        [current.conductor_id]
      )
      : null;
    const vehicleId = current.vehiculo_id || null;
    const driverId = assignedDriver?.rows[0]?.id || null;
    const initialState = vehicleId && driverId ? "asignada" : "programada";
    const created = await client.query(
      `INSERT INTO operaciones
       (reserva_id, tipo_servicio, fecha_programada, fecha_fin_programada, hora_inicio, hora_fin, origen, destino, pasajeros,
        vehiculo_id, conductor_id, estado, creado_por)
       VALUES (
         $1, 'reserva',
         COALESCE($2::timestamp::date, $3::timestamp::date, $4::date),
         COALESCE($6::date, $7::date, COALESCE($2::timestamp::date, $3::timestamp::date, $4::date)),
         $2::timestamp::time,
         CASE WHEN $5::timestamp::date = COALESCE($2::timestamp::date, $3::timestamp::date, $4::date)
              THEN $5::timestamp::time ELSE NULL END,
         $8, $9, $10, $11, $12, $13, $14
       )
       RETURNING id`,
      [
        reservationId,
        current.fecha_salida,
        current.fecha_servicio,
        current.fecha_reserva,
        current.fecha_llegada,
        current.fecha_fin,
        current.fecha_regreso,
        String(current.origen || "Origen pendiente").trim(),
        String(current.destino || "Destino pendiente").trim(),
        Number(current.num_personas) || 1,
        vehicleId,
        driverId,
        initialState,
        req.user?.id || null,
      ]
    );

    const operationId = Number(created.rows[0].id);
    if (current.conductor_id && !driverId) {
      await client.query("UPDATE reservas SET conductor_id = NULL WHERE id = $1", [reservationId]);
    }
    await client.query(
      "UPDATE reservas SET estado_operativo = $1 WHERE id = $2",
      [initialState, reservationId]
    );
    await recordHistory(client, operationId, req.user?.id || null, "creacion_desde_reserva", null, initialState, { reserva_id: reservationId });
    const operation = await getOperation(client, operationId);
    await client.query("COMMIT");
    return res.status(201).json({ success: true, data: operation });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error creando despacho desde reserva:", error);
    return res.status(500).json({ success: false, error: "No se pudo preparar la reserva para despacho" });
  } finally {
    client.release();
  }
};

const crearOperacion = async (req: any, res: any) => {
  const body = req.body || {};
  const date = dateOrNull(body.fecha_programada);
  const endDate = body.fecha_fin_programada ? dateOrNull(body.fecha_fin_programada) : date;
  const start = timeOrNull(body.hora_inicio);
  const end = timeOrNull(body.hora_fin);
  const passengers = Number(body.pasajeros);
  const estimatedKm = numberOrNull(body.kilometros_estimados);

  if (!date || !endDate || endDate < date || !body.origen || !body.destino || !Number.isInteger(passengers) || passengers <= 0) {
    return res.status(400).json({ success: false, error: "Fecha, origen, destino y pasajeros válidos son obligatorios" });
  }
  if (body.hora_inicio && !start || body.hora_fin && !end || start && end && end <= start) {
    return res.status(400).json({ success: false, error: "El horario de la operación no es válido" });
  }

  try {
    const result = await pool.query(
      `INSERT INTO operaciones
       (reserva_id, tipo_servicio, fecha_programada, fecha_fin_programada, hora_inicio, hora_fin, origen, destino, pasajeros, kilometros_estimados, observaciones, creado_por)
       VALUES ($1, $2, $3::date, $4::date, $5::time, $6::time, $7, $8, $9, $10, $11, $12)
       RETURNING id`,
      [numberOrNull(body.reserva_id), String(body.tipo_servicio || "viaje").trim().slice(0, 80), date, endDate, start, end, String(body.origen).trim(), String(body.destino).trim(), passengers, estimatedKm, body.observaciones || null, req.user?.id || null]
    );

    await recordHistory(pool, result.rows[0].id, req.user?.id || null, "creacion", null, "programada", { origen: body.origen, destino: body.destino });
    const operation = await getOperation(pool, result.rows[0].id);
    return res.status(201).json({ success: true, data: operation });
  } catch (error) {
    console.error("Error creando operación:", error);
    return res.status(500).json({ success: false, error: "No se pudo crear la operación" });
  }
};

const asignarOperacion = async (req: any, res: any) => {
  const operationId = Number(req.params.id);
  const vehicleId = Number(req.body?.vehiculo_id);
  const driverUserId = Number(req.body?.conductor_id);
  const decisionId = req.body?.decision_id === undefined ? null : Number(req.body.decision_id);
  const decisionReason = typeof req.body?.decision_reason === "string" ? req.body.decision_reason.trim() : "";
  if (!Number.isInteger(operationId) || operationId <= 0
    || !Number.isInteger(vehicleId) || vehicleId <= 0
    || !Number.isInteger(driverUserId) || driverUserId <= 0) {
    return res.status(400).json({ success: false, error: "Operación, vehículo y conductor son obligatorios" });
  }
  if ((decisionId !== null && (!Number.isInteger(decisionId) || decisionId <= 0)) || decisionReason.length > 500) {
    return res.status(400).json({ success: false, error: "La decisión de recomendación o su motivo no son válidos" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const reject = async (status: number, body: Record<string, unknown>) => {
      await client.query("ROLLBACK");
      return res.status(status).json(body);
    };
    const operation = await client.query("SELECT * FROM operaciones WHERE id = $1 FOR UPDATE", [operationId]);
    if (!operation.rowCount) return reject(404, { success: false, error: "Operación no encontrada" });
    const current = operation.rows[0];
    if (!["programada", "asignada", "incidencia"].includes(current.estado)) {
      return reject(409, { success: false, error: "La operación no permite cambiar la asignación en su estado actual" });
    }
    if (current.subcontratacion_estado && current.subcontratacion_estado !== "no_requerida") {
      return reject(409, { success: false, error: "Retira la subcontratación antes de asignar recursos propios" });
    }

    const linkedReservation = current.reserva_id
      ? await client.query("SELECT fecha_fin::text AS fecha_fin, fecha_regreso::text AS fecha_regreso FROM reservas WHERE id = $1", [current.reserva_id])
      : { rows: [] };
    const endDate = current.fecha_fin_programada
      || linkedReservation.rows[0]?.fecha_fin
      || linkedReservation.rows[0]?.fecha_regreso
      || current.fecha_programada;

    const vehicle = await client.query(
      `SELECT id, placa, capacidad, estado, activo,
              (fecha_proximo_mantenimiento IS NOT NULL AND fecha_proximo_mantenimiento <= CURRENT_DATE)
              OR (proximo_km_mantenimiento IS NOT NULL AND proximo_km_mantenimiento <= COALESCE(kilometraje, 0)) AS mantenimiento_vencido
       FROM vehiculos WHERE id = $1 FOR UPDATE`,
      [vehicleId]
    );
    if (!vehicle.rowCount) return reject(404, { success: false, error: "Vehículo no encontrado" });
    const vehicleData = vehicle.rows[0];
    if (!vehicleData.activo || vehicleData.estado !== "disponible") {
      return reject(409, { success: false, error: "El vehículo no está operativo" });
    }
    if (Number(vehicleData.capacidad) < Number(current.pasajeros)) {
      return reject(409, { success: false, error: "La capacidad del vehículo es insuficiente" });
    }
    if (vehicleData.mantenimiento_vencido) {
      return reject(409, { success: false, error: "El vehículo tiene mantenimiento vencido" });
    }

    const unavailableDate = await client.query(
      `SELECT dia.fecha::date::text AS fecha,
              CASE
                WHEN vd.disponible = false THEN 'bloqueo manual'
                ELSE 'día no laborable'
              END AS motivo
       FROM vehiculos v
       CROSS JOIN LATERAL generate_series($2::date, $3::date, INTERVAL '1 day') AS dia(fecha)
       LEFT JOIN vehiculo_disponibilidad vd
         ON vd.vehiculo_id = v.id AND vd.fecha = dia.fecha
       WHERE v.id = $1
         AND (
           vd.disponible = false
           OR (vd.disponible IS DISTINCT FROM true
               AND NOT (EXTRACT(DOW FROM dia.fecha)::int = ANY(COALESCE(v.dias_servicio, ARRAY[0,1,2,3,4,5,6]))))
         )
       ORDER BY dia.fecha
       LIMIT 1`,
      [vehicleId, current.fecha_programada, endDate]
    );
    if (unavailableDate.rowCount) {
      const { fecha, motivo } = unavailableDate.rows[0];
      return reject(409, {
        success: false,
        error: motivo === "bloqueo manual"
          ? `El vehículo está bloqueado manualmente el ${fecha}`
          : `El vehículo no ofrece servicio el ${fecha}`,
        disponibilidad: unavailableDate.rows[0],
      });
    }

    const scheduledMaintenance = await client.query(
      `SELECT id, tipo, fecha_programada::text AS fecha_programada, estado
       FROM mantenimiento_vehiculos
       WHERE vehiculo_id = $1
         AND (
           estado = 'en_progreso'
           OR (estado = 'programado' AND fecha_programada BETWEEN $2::date AND $3::date)
         )
       ORDER BY fecha_programada ASC, id ASC
       LIMIT 1`,
      [vehicleId, current.fecha_programada, endDate]
    );
    if (scheduledMaintenance.rowCount) {
      const maintenance = scheduledMaintenance.rows[0];
      return reject(409, {
        success: false,
        error: maintenance.estado === "en_progreso"
          ? "El vehículo tiene un mantenimiento en curso y no está disponible"
          : `El vehículo tiene mantenimiento programado para el ${maintenance.fecha_programada}`,
        mantenimiento: maintenance,
      });
    }

    const externalBlock = await client.query(
      `SELECT id, fecha_inicio::text, fecha_fin::text, hora_inicio::text, hora_fin::text,
              motivo, cliente_empresa, origen, destino, notas
       FROM disponibilidad_externa
       WHERE vehiculo_id = $1 AND estado = 'activo'
         AND fecha_inicio <= $3::date AND fecha_fin >= $2::date
         AND (
           $2::date <> $3::date OR hora_inicio IS NULL OR $4::time IS NULL
           OR hora_fin IS NULL OR $5::time IS NULL
           OR (hora_inicio < $5::time AND $4::time < hora_fin)
         )
       ORDER BY fecha_inicio, hora_inicio NULLS LAST, id
       LIMIT 1`,
      [vehicleId, current.fecha_programada, endDate, current.hora_inicio, current.hora_fin]
    );
    if (externalBlock.rowCount) {
      const block = externalBlock.rows[0];
      return reject(409, {
        success: false,
        error: block.motivo === "fuera_de_servicio"
          ? "El vehículo está fuera de servicio por un bloqueo externo"
          : "El vehículo está ocupado externamente en el horario solicitado",
        conflicto: { ...block, vehiculo_id: vehicleId, placa: vehicleData.placa },
      });
    }

    const driver = await client.query(
      `SELECT c.id, c.usuario_id, c.estado, c.fecha_licencia_vencimiento, u.activo,
              (c.fecha_licencia_vencimiento IS NULL) AS licencia_sin_vigencia,
              (c.fecha_licencia_vencimiento IS NOT NULL
               AND c.fecha_licencia_vencimiento < CURRENT_DATE) AS licencia_vencida
       FROM conductores c JOIN usuarios u ON u.id = c.usuario_id
       WHERE c.usuario_id = $1 FOR UPDATE`,
      [driverUserId]
    );
    if (!driver.rowCount) return reject(404, { success: false, error: "El usuario no tiene un perfil de conductor configurado" });
    const driverData = driver.rows[0];
    const driverId = Number(driverData.id);
    if (!driverData.activo || ["inactivo", "mantenimiento"].includes(driverData.estado)) {
      return reject(409, { success: false, error: "El conductor no está disponible" });
    }
    if (driverData.licencia_sin_vigencia) {
      return reject(409, { success: false, error: "El conductor no tiene una vigencia de licencia registrada" });
    }
    if (driverData.licencia_vencida) {
      return reject(409, { success: false, error: "La licencia del conductor está vencida" });
    }

    const externalDriverBlock = await client.query(
      `SELECT id, fecha_inicio::text, fecha_fin::text, hora_inicio::text, hora_fin::text, motivo
       FROM disponibilidad_externa
       WHERE conductor_usuario_id = $1
         AND estado = 'activo'
         AND motivo <> 'fuera_de_servicio'
         AND fecha_inicio <= $3::date AND fecha_fin >= $2::date
         AND (
           $2::date <> $3::date OR hora_inicio IS NULL OR $4::time IS NULL
           OR hora_fin IS NULL OR $5::time IS NULL
           OR (hora_inicio < $5::time AND $4::time < hora_fin)
         )
       ORDER BY fecha_inicio, hora_inicio NULLS LAST, id
       LIMIT 1`,
      [driverUserId, current.fecha_programada, endDate, current.hora_inicio, current.hora_fin]
    );
    if (externalDriverBlock.rowCount) {
      return reject(409, {
        success: false,
        error: "El conductor está ocupado externamente en el horario solicitado",
        conflicto: externalDriverBlock.rows[0],
      });
    }

    const conflict = await findScheduleConflict(
      client,
      operationId,
      current.fecha_programada,
      endDate,
      current.hora_inicio,
      current.hora_fin,
      vehicleId,
      driverId,
      driverUserId
    );
    if (conflict) {
      const isVehicleConflict = Number(conflict.vehiculo_id) === vehicleId;
      const resource = isVehicleConflict
        ? `vehículo ${conflict.placa || vehicleId}`
        : "conductor seleccionado";
      const occupation = conflict.reserva_id
        ? `ocupado en otra reserva #${conflict.reserva_id}`
        : "ocupado en otro servicio";
      return reject(409, { success: false, error: `No Disponible: el ${resource} está ${occupation}.`, conflicto: conflict });
    }

    await client.query(
      `UPDATE operaciones SET vehiculo_id = $1, conductor_id = $2, estado = 'asignada', actualizado_en = CURRENT_TIMESTAMP WHERE id = $3`,
      [vehicleId, driverId, operationId]
    );
    if (current.reserva_id) {
      const reservation = await client.query(
        "SELECT id, estado, estado_operativo FROM reservas WHERE id = $1 FOR UPDATE",
        [current.reserva_id]
      );
      if (!reservation.rowCount || ["cancelada", "finalizada"].includes(String(reservation.rows[0]?.estado))) {
        return reject(409, { success: false, error: "La reserva vinculada ya no permite asignar recursos" });
      }
      if (reservation.rows[0].estado_operativo === "en_curso") {
        return reject(409, { success: false, error: "El viaje ya comenzó; no se pueden cambiar los recursos desde Despacho" });
      }

      if (!current.requerimiento_id) {
        const target = await client.query(
        `SELECT ccu.table_name AS referenced_table
         FROM information_schema.table_constraints tc
         INNER JOIN information_schema.key_column_usage kcu
           ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
         INNER JOIN information_schema.constraint_column_usage ccu
           ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
         WHERE tc.table_schema = 'public' AND tc.table_name = 'reservas'
           AND tc.constraint_type = 'FOREIGN KEY' AND kcu.column_name = 'conductor_id'
         LIMIT 1`
        );
        const conductorReference = String(target.rows[0]?.referenced_table || "usuarios").toLowerCase() === "conductores"
          ? driverId
          : driverData.usuario_id;
        await client.query(
          "UPDATE reservas SET vehiculo_id = $1, conductor_id = $2, estado_operativo = 'asignada' WHERE id = $3",
          [vehicleId, conductorReference, current.reserva_id]
        );
      }
    }
    if (decisionId !== null) {
      const decision = await client.query(
        `UPDATE decisiones_sistema
         SET entidad_id = $2,
             resultado = CASE
               WHEN (recomendacion->'vehiculo'->>'vehiculo_id')::int = $2 THEN 'aceptada'
               ELSE 'alternativa'
             END,
             confirmado_por = $3,
             factores = factores || jsonb_build_object(
               'decision_operador',
               jsonb_build_object(
                 'vehiculo_id', $2,
                 'resultado', CASE
                   WHEN (recomendacion->'vehiculo'->>'vehiculo_id')::int = $2 THEN 'aceptada'
                   ELSE 'alternativa'
                 END,
                 'motivo', NULLIF($4, ''),
                 'registrado_en', CURRENT_TIMESTAMP,
                 'operacion_id', $5
               )
             )
         WHERE id = $1
           AND tipo_decision = 'asignacion_vehiculo'
           AND resultado IS NULL
           AND (recomendacion->>'operacion_id')::int = $5
           AND recomendacion->>'fecha' = $6::date::text
           AND COALESCE(recomendacion->>'fecha_fin', recomendacion->>'fecha') = $10::date::text
           AND (recomendacion->>'pasajeros')::int = $7
           AND recomendacion->>'hora_inicio' IS NOT DISTINCT FROM to_char($8::time, 'HH24:MI')
           AND recomendacion->>'hora_fin' IS NOT DISTINCT FROM to_char($9::time, 'HH24:MI')
           AND (
             (recomendacion->'vehiculo'->>'vehiculo_id')::int = $2
             OR (
               NULLIF($4, '') IS NOT NULL
               AND EXISTS (
                 SELECT 1
                 FROM jsonb_array_elements(recomendacion->'alternativas') AS opciones(opcion)
                 WHERE (opciones.opcion->>'vehiculo_id')::int = $2
               )
             )
           )
         RETURNING id`,
        [
          decisionId,
          vehicleId,
          req.user?.id || null,
          decisionReason,
          operationId,
          current.fecha_programada,
          Number(current.pasajeros),
          current.hora_inicio,
          current.hora_fin,
          endDate,
        ]
      );
      if (!decision.rowCount) {
        return reject(409, { success: false, error: "La recomendación ya se registró o el vehículo no es una alternativa válida. Si elegiste otra opción, indica el motivo." });
      }
    }
    await recordHistory(client, operationId, req.user?.id || null, "asignacion", current.estado, "asignada", { vehiculo_id: vehicleId, conductor_id: driverId });
    const updated = await getOperation(client, operationId);
    await client.query("COMMIT");
    return res.json({ success: true, data: updated });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error asignando operación:", error);
    return res.status(500).json({ success: false, error: "No se pudo asignar la operación" });
  } finally {
    client.release();
  }
};

const actualizarSubcontratacion = async (req: any, res: any) => {
  const operationId = Number(req.params.id);
  const body = req.body || {};
  const subcontractingState = String(body.estado || "");
  const companyId = subcontractingState === "no_requerida"
    || body.empresa_asociada_id === undefined || body.empresa_asociada_id === null || body.empresa_asociada_id === ""
    ? null
    : Number(body.empresa_asociada_id);
  const associatedVehicleId = subcontractingState === "no_requerida"
    || body.vehiculo_asociado_id === undefined || body.vehiculo_asociado_id === null || body.vehiculo_asociado_id === ""
    ? null
    : Number(body.vehiculo_asociado_id);
  if (!Number.isInteger(operationId) || operationId <= 0
    || !VALID_SUBCONTRACTING_STATES.includes(subcontractingState)
    || (companyId !== null && (!Number.isInteger(companyId) || companyId <= 0))
    || (associatedVehicleId !== null && (!Number.isInteger(associatedVehicleId) || associatedVehicleId <= 0))
    || (associatedVehicleId !== null && companyId === null)) {
    return res.status(400).json({ success: false, error: "Operación o estado de subcontratación inválidos" });
  }

  const details = {
    empresa: textOrNull(body.empresa, 160),
    contacto: textOrNull(body.contacto, 120),
    telefono: textOrNull(body.telefono, 40),
    vehiculo: textOrNull(body.vehiculo, 120),
    placa: textOrNull(body.placa, 30),
    conductor: textOrNull(body.conductor, 120),
    conductorTelefono: textOrNull(body.conductor_telefono, 40),
  };
  const rawCost = body.costo;
  const cost = rawCost === "" || rawCost === null || rawCost === undefined ? null : Number(rawCost);
  if (hasInvalidText(body.empresa, 160)
    || hasInvalidText(body.contacto, 120)
    || hasInvalidText(body.telefono, 40)
    || hasInvalidText(body.vehiculo, 120)
    || hasInvalidText(body.placa, 30)
    || hasInvalidText(body.conductor, 120)
    || hasInvalidText(body.conductor_telefono, 40)) {
    return res.status(400).json({ success: false, error: "Uno o más datos de subcontratación no son válidos o superan el límite permitido" });
  }
  if (rawCost !== "" && rawCost !== null && rawCost !== undefined
    && (cost === null || !Number.isFinite(cost) || cost < 0 || cost > 99999999.99)) {
    return res.status(400).json({ success: false, error: "El costo de subcontratación debe ser un valor válido y no negativo" });
  }
  if (subcontractingState === "confirmada" && cost === null) {
    return res.status(400).json({ success: false, error: "Para confirmar registra empresa, contacto, teléfono, vehículo, placa, conductor, teléfono del conductor y costo acordado" });
  }
  if (subcontractingState === "confirmada" && companyId === null
    && (!details.empresa || !details.contacto || !details.telefono || !details.vehiculo
      || !details.placa || !details.conductor || !details.conductorTelefono)) {
    return res.status(400).json({ success: false, error: "Completa los datos de la empresa y del vehículo antes de confirmar" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const currentResult = await client.query("SELECT * FROM operaciones WHERE id = $1 FOR UPDATE", [operationId]);
    if (!currentResult.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ success: false, error: "Operación no encontrada" });
    }

    const current = currentResult.rows[0];
    if (!["programada", "asignada", "incidencia"].includes(current.estado)) {
      await client.query("ROLLBACK");
      return res.status(409).json({ success: false, error: "La operación no permite cambiar la subcontratación en su estado actual" });
    }

    if (companyId !== null) {
      const companyResult = await client.query(
        "SELECT id, nombre, contacto, telefono, activa FROM empresas_asociadas WHERE id = $1 FOR UPDATE",
        [companyId]
      );
      if (!companyResult.rowCount || !companyResult.rows[0].activa) {
        await client.query("ROLLBACK");
        return res.status(409).json({ success: false, error: "La empresa asociada no existe o está inactiva" });
      }
      details.empresa = companyResult.rows[0].nombre;
      details.contacto = companyResult.rows[0].contacto;
      details.telefono = companyResult.rows[0].telefono;
    }

    if (associatedVehicleId !== null) {
      const vehicleResult = await client.query(
        `SELECT id, empresa_id, placa, modelo, capacidad, conductor, conductor_telefono, activo
         FROM vehiculos_asociados WHERE id = $1 FOR UPDATE`,
        [associatedVehicleId]
      );
      const partnerVehicle = vehicleResult.rows[0];
      if (!partnerVehicle || !partnerVehicle.activo || partnerVehicle.empresa_id !== companyId) {
        await client.query("ROLLBACK");
        return res.status(409).json({ success: false, error: "El vehículo no pertenece a la empresa activa seleccionada" });
      }
      if (Number(partnerVehicle.capacidad) < Number(current.pasajeros)) {
        await client.query("ROLLBACK");
        return res.status(409).json({ success: false, error: "La capacidad del vehículo asociado es insuficiente" });
      }
      details.vehiculo = partnerVehicle.modelo;
      details.placa = partnerVehicle.placa;
      details.conductor = partnerVehicle.conductor;
      details.conductorTelefono = partnerVehicle.conductor_telefono;
    }

    if (subcontractingState === "confirmada" && companyId !== null && associatedVehicleId === null) {
      await client.query("ROLLBACK");
      return res.status(400).json({ success: false, error: "Selecciona un vehículo registrado de la empresa asociada" });
    }
    if (subcontractingState === "confirmada"
      && (!details.empresa || !details.contacto || !details.telefono || !details.vehiculo
        || !details.placa || !details.conductor || !details.conductorTelefono)) {
      await client.query("ROLLBACK");
      return res.status(400).json({ success: false, error: "La empresa y el vehículo deben tener todos los datos de contacto operativos" });
    }
    if (subcontractingState === "confirmada" && associatedVehicleId !== null) {
      const endDate = current.fecha_fin_programada || current.fecha_programada;
      const conflict = await client.query(
        `SELECT id FROM operaciones
         WHERE id <> $1 AND vehiculo_asociado_id = $2
           AND estado = ANY($3::text[])
           AND fecha_programada <= $5::date
           AND COALESCE(fecha_fin_programada, fecha_programada) >= $4::date
           AND (
             $4::date <> $5::date OR COALESCE(fecha_fin_programada, fecha_programada) <> fecha_programada
             OR hora_inicio IS NULL OR hora_fin IS NULL OR $6::time IS NULL OR $7::time IS NULL
             OR (hora_inicio < $7::time AND $6::time < hora_fin)
           )
         LIMIT 1`,
        [operationId, associatedVehicleId, ACTIVE_STATES, current.fecha_programada, endDate, current.hora_inicio, current.hora_fin]
      );
      if (conflict.rowCount) {
        await client.query("ROLLBACK");
        return res.status(409).json({ success: false, error: "El vehículo asociado ya está asignado a otra operación en ese horario" });
      }
    }

    const nextOperationState = subcontractingState === "confirmada" ? "asignada" : "programada";
    const clearDetails = subcontractingState === "no_requerida";
    await client.query(
      `UPDATE operaciones
       SET subcontratacion_estado = $1,
           subcontratista_empresa = $2,
           subcontratista_contacto = $3,
           subcontratista_telefono = $4,
           subcontratista_vehiculo = $5,
           subcontratista_placa = $6,
           subcontratista_conductor = $7,
           subcontratista_conductor_telefono = $8,
           subcontratacion_costo = $9,
           vehiculo_id = NULL,
           conductor_id = NULL,
           estado = $10,
           actualizado_en = CURRENT_TIMESTAMP,
           empresa_asociada_id = $12,
           vehiculo_asociado_id = $13
       WHERE id = $11`,
      [
        subcontractingState,
        clearDetails ? null : details.empresa,
        clearDetails ? null : details.contacto,
        clearDetails ? null : details.telefono,
        clearDetails ? null : details.vehiculo,
        clearDetails ? null : details.placa,
        clearDetails ? null : details.conductor,
        clearDetails ? null : details.conductorTelefono,
        clearDetails ? null : cost,
        nextOperationState,
        operationId,
        clearDetails ? null : companyId,
        clearDetails ? null : associatedVehicleId,
      ]
    );

    if (current.reserva_id && !current.requerimiento_id) {
      await client.query(
        "UPDATE reservas SET vehiculo_id = NULL, conductor_id = NULL WHERE id = $1",
        [current.reserva_id]
      );
    }

    await recordHistory(
      client,
      operationId,
      req.user?.id || null,
      "actualizar_subcontratacion",
      current.subcontratacion_estado || "no_requerida",
      subcontractingState,
      clearDetails ? { accion: "retirada" } : {
        ...details,
        empresa_asociada_id: companyId,
        vehiculo_asociado_id: associatedVehicleId,
        costo: cost,
      }
    );
    const updated = await getOperation(client, operationId);
    await client.query("COMMIT");
    return res.json({ success: true, data: updated });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error actualizando subcontratación:", error);
    return res.status(500).json({ success: false, error: "No se pudo actualizar la subcontratación" });
  } finally {
    client.release();
  }
};

const actualizarEstadoOperacion = async (req: any, res: any) => {
  const operationId = Number(req.params.id);
  const nextState = String(req.body?.estado || "");
  if (!Number.isInteger(operationId) || !VALID_STATES.includes(nextState)) {
    return res.status(400).json({ success: false, error: "Estado u operación inválidos" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const current = await client.query("SELECT * FROM operaciones WHERE id = $1 FOR UPDATE", [operationId]);
    if (!current.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ success: false, error: "Operación no encontrada" });
    }
    const operation = current.rows[0];
    if (operation.reserva_id && !operation.requerimiento_id && ["en_curso", "completada"].includes(nextState)) {
      await client.query("ROLLBACK");
      return res.status(403).json({ success: false, error: "El conductor actualiza el inicio y la finalización desde su portal" });
    }
    const hasOwnResources = operation.vehiculo_id && operation.conductor_id;
    const hasConfirmedSubcontracting = operation.subcontratacion_estado === "confirmada"
      && operation.subcontratista_empresa
      && operation.subcontratista_vehiculo
      && operation.subcontratista_placa
      && operation.subcontratista_conductor;
    if (nextState === "en_curso" && !hasOwnResources && !hasConfirmedSubcontracting) {
      await client.query("ROLLBACK");
      return res.status(409).json({ success: false, error: "No se puede iniciar una operación sin vehículo y conductor" });
    }
    const now = nextState === "en_curso" ? "hora_inicio_real = CURRENT_TIMESTAMP," : nextState === "completada" ? "hora_fin_real = CURRENT_TIMESTAMP," : "";
    await client.query(`UPDATE operaciones SET estado = $1, ${now} actualizado_en = CURRENT_TIMESTAMP WHERE id = $2`, [nextState, operationId]);
    if (operation.requerimiento_id && nextState === "completada") {
      const progress = await client.query(
        `SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE estado = 'completada')::int AS completadas
         FROM operaciones WHERE requerimiento_id = $1`,
        [operation.requerimiento_id]
      );
      if (Number(progress.rows[0].total) > 0
        && Number(progress.rows[0].total) === Number(progress.rows[0].completadas)) {
        await client.query(
          "UPDATE reservas SET estado = 'finalizada', estado_operativo = 'finalizada' WHERE id = $1 AND estado = 'confirmada'",
          [operation.reserva_id]
        );
      }
    }
    if (operation.reserva_id && !operation.requerimiento_id && nextState === "cancelada") {
      await client.query(
        `UPDATE reservas
         SET vehiculo_id = NULL, conductor_id = NULL, estado_operativo = NULL
         WHERE id = $1 AND estado = 'confirmada'`,
        [operation.reserva_id]
      );
    }
    await recordHistory(client, operationId, req.user?.id || null, "cambio_estado", operation.estado, nextState);
    const updated = await getOperation(client, operationId);
    await client.query("COMMIT");
    return res.json({ success: true, data: updated });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error actualizando operación:", error);
    return res.status(500).json({ success: false, error: "No se pudo actualizar el estado" });
  } finally {
    client.release();
  }
};

const reabrirOperacion = async (req: any, res: any) => {
  const operationId = Number(req.params.id);
  if (!Number.isInteger(operationId) || operationId <= 0) {
    return res.status(400).json({ success: false, error: "ID de operación inválido" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const current = await client.query("SELECT * FROM operaciones WHERE id = $1 FOR UPDATE", [operationId]);
    if (!current.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ success: false, error: "Operación no encontrada" });
    }
    const operation = current.rows[0];
    if (operation.estado !== "cancelada") {
      await client.query("ROLLBACK");
      return res.status(409).json({ success: false, error: "Solo se pueden reabrir operaciones canceladas" });
    }

    if (operation.reserva_id && !operation.requerimiento_id) {
      const reservation = await client.query(
        "SELECT id, estado FROM reservas WHERE id = $1 FOR UPDATE",
        [operation.reserva_id]
      );
      if (!reservation.rowCount || reservation.rows[0].estado !== "confirmada") {
        await client.query("ROLLBACK");
        return res.status(409).json({ success: false, error: "La reserva vinculada ya no está confirmada" });
      }
      await client.query(
        "UPDATE reservas SET vehiculo_id = NULL, conductor_id = NULL, estado_operativo = NULL WHERE id = $1",
        [operation.reserva_id]
      );
    }

    await client.query(
      `UPDATE operaciones
       SET estado = 'programada', vehiculo_id = NULL, conductor_id = NULL, actualizado_en = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [operationId]
    );
    await recordHistory(client, operationId, req.user?.id || null, "reapertura_despacho", "cancelada", "programada");
    const updated = await getOperation(client, operationId);
    await client.query("COMMIT");
    return res.json({ success: true, data: updated });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error reabriendo operación:", error);
    return res.status(500).json({ success: false, error: "No se pudo reabrir la operación" });
  } finally {
    client.release();
  }
};

const historialOperacion = async (req: any, res: any) => {
  const operationId = Number(req.params.id);
  if (!Number.isInteger(operationId)) return res.status(400).json({ success: false, error: "ID inválido" });
  try {
    const result = await pool.query(
      `SELECT h.*, u.nombre AS usuario_nombre, u.apellido AS usuario_apellido
       FROM operacion_historial h LEFT JOIN usuarios u ON u.id = h.usuario_id
       WHERE h.operacion_id = $1 ORDER BY h.creado_en DESC`,
      [operationId]
    );
    return res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error("Error consultando historial de operación:", error);
    return res.status(500).json({ success: false, error: "No se pudo consultar el historial" });
  }
};

module.exports = {
  listarOperaciones,
  listarReservasPorDespachar,
  crearOperacionDesdeReserva,
  crearOperacion,
  asignarOperacion,
  actualizarSubcontratacion,
  actualizarEstadoOperacion,
  reabrirOperacion,
  historialOperacion,
};
