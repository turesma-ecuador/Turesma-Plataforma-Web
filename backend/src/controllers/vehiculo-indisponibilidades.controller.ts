export {};

const pool = require("../config/db");
const { notificarAdmins, crearNotificacion } = require("../config/notificaciones");

const isValidDate = (value: unknown): value is string => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

const parseTime = (value: unknown) => {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || !/^\d{2}:\d{2}$/.test(value)) return undefined;
  const [hours, minutes] = value.split(":").map(Number);
  return hours < 24 && minutes < 60 ? value : undefined;
};

const dateOverlapCondition = `
  b.fecha_inicio <= $3::date
  AND COALESCE(b.fecha_fin, 'infinity'::date) >= $2::date
  AND (
    $2::date <> $3::date
    OR b.hora_inicio IS NULL OR $4::time IS NULL
    OR b.hora_fin IS NULL OR $5::time IS NULL
    OR (b.hora_inicio < $5::time AND $4::time < b.hora_fin)
  )`;

const findExistingTripConflicts = async (
  client: any,
  vehicleId: number,
  startDate: string,
  endDate: string | null,
  startTime: string | null,
  endTime: string | null,
) => {
  const effectiveEndDate = endDate || "9999-12-31";
  const operations = await client.query(
    `SELECT o.id, o.reserva_id, o.fecha_programada::text AS fecha_inicio,
            COALESCE(o.fecha_fin_programada, o.fecha_programada)::text AS fecha_fin,
            o.estado, o.tipo_servicio,
            v.placa
     FROM operaciones o
     JOIN vehiculos v ON v.id = o.vehiculo_id
     WHERE o.vehiculo_id = $1
       AND o.estado IN ('programada', 'asignada', 'en_curso', 'incidencia')
       AND o.fecha_programada <= $3::date
       AND COALESCE(o.fecha_fin_programada, o.fecha_programada) >= $2::date
       AND (
         $2::date <> $3::date
         OR $4::time IS NULL OR $5::time IS NULL OR o.hora_inicio IS NULL OR o.hora_fin IS NULL
         OR (o.hora_inicio < $5::time AND $4::time < o.hora_fin)
       )
     ORDER BY o.fecha_programada, o.id`,
    [vehicleId, startDate, effectiveEndDate, startTime, endTime]
  );
  const reservations = await client.query(
    `SELECT r.id AS reserva_id, r.estado,
            COALESCE(r.fecha_salida::date, r.fecha_servicio::date, r.fecha_reserva)::text AS fecha_inicio,
            COALESCE(r.fecha_llegada::date, r.fecha_fin, r.fecha_regreso,
                     r.fecha_salida::date, r.fecha_servicio::date, r.fecha_reserva)::text AS fecha_fin,
            v.placa
     FROM reservas r
     JOIN vehiculos v ON v.id = r.vehiculo_id
     WHERE r.vehiculo_id = $1
       AND r.estado NOT IN ('cancelada', 'finalizada')
       AND COALESCE(r.fecha_salida::date, r.fecha_servicio::date, r.fecha_reserva) <= $3::date
       AND COALESCE(r.fecha_llegada::date, r.fecha_fin, r.fecha_regreso,
                    r.fecha_salida::date, r.fecha_servicio::date, r.fecha_reserva) >= $2::date
       AND NOT EXISTS (
         SELECT 1 FROM operaciones o
         WHERE o.reserva_id = r.id
           AND o.estado IN ('programada', 'asignada', 'en_curso', 'incidencia')
       )
       AND (
         $2::date <> $3::date
         OR $4::time IS NULL OR $5::time IS NULL
         OR r.fecha_salida IS NULL OR r.fecha_llegada IS NULL
         OR (r.fecha_salida::time < $5::time AND $4::time < r.fecha_llegada::time)
       )
     ORDER BY fecha_inicio, r.id`,
    [vehicleId, startDate, effectiveEndDate, startTime, endTime]
  );

  return [
    ...operations.rows.map((row: any) => ({ ...row, tipo: "operacion" })),
    ...reservations.rows.map((row: any) => ({ ...row, tipo: "reserva" })),
  ];
};

const getDriverVehicleIds = async (client: any, userId: number) => {
  const result = await client.query(
    `SELECT id AS vehiculo_id
     FROM vehiculos
     WHERE usuario_id = $1 AND activo = true
     UNION
     SELECT av.vehiculo_id
     FROM asignacion_vehiculos av
     JOIN conductores c ON c.id = av.conductor_id
     JOIN vehiculos v ON v.id = av.vehiculo_id
     WHERE c.usuario_id = $1 AND av.estado = 'activa' AND v.activo = true`,
    [userId]
  );
  return result.rows.map((row: any) => Number(row.vehiculo_id));
};

const getDriverUserForVehicle = async (client: any, vehicleId: number) => {
  const result = await client.query(
    `SELECT COALESCE(v.usuario_id, c.usuario_id) AS usuario_id
     FROM vehiculos v
     LEFT JOIN asignacion_vehiculos av ON av.vehiculo_id = v.id AND av.estado = 'activa'
     LEFT JOIN conductores c ON c.id = av.conductor_id
     WHERE v.id = $1
     ORDER BY av.id DESC NULLS LAST
     LIMIT 1`,
    [vehicleId]
  );
  return result.rows[0]?.usuario_id ? Number(result.rows[0].usuario_id) : null;
};

const listDriverVehicleUnavailability = async (req: any, res: any) => {
  const userId = Number(req.params.id);
  try {
    const vehicleIds = await getDriverVehicleIds(pool, userId);
    if (!vehicleIds.length) return res.json([]);
    const result = await pool.query(
      `SELECT b.*, v.placa, v.modelo, u.nombre AS creado_por_nombre
       FROM vehiculo_indisponibilidades b
       JOIN vehiculos v ON v.id = b.vehiculo_id
       JOIN usuarios u ON u.id = b.creado_por
       WHERE b.vehiculo_id = ANY($1::int[])
         AND (b.estado = 'activa' OR b.creado_en >= CURRENT_TIMESTAMP - INTERVAL '90 days')
       ORDER BY CASE WHEN b.estado = 'activa' THEN 0 ELSE 1 END, b.fecha_inicio DESC, b.id DESC
       LIMIT 100`,
      [vehicleIds]
    );
    return res.json(result.rows);
  } catch (error) {
    console.error("Error listando indisponibilidades del vehículo:", error);
    return res.status(500).json({ error: "No se pudieron cargar los avisos de mantenimiento" });
  }
};

const createDriverVehicleUnavailability = async (req: any, res: any) => {
  const userId = Number(req.params.id);
  const vehicleId = Number(req.body?.vehiculo_id);
  const tipo = req.body?.tipo;
  const urgente = req.body?.urgente === true;
  const startDate = urgente ? new Date().toISOString().slice(0, 10) : req.body?.fecha_inicio;
  const endDate = urgente ? null : req.body?.fecha_fin;
  const startTime = parseTime(req.body?.hora_inicio);
  const endTime = parseTime(req.body?.hora_fin);
  const motivo = typeof req.body?.motivo === "string" ? req.body.motivo.trim() : "";

  if (!Number.isInteger(vehicleId) || vehicleId <= 0
    || !["preventivo", "correctivo"].includes(tipo)
    || (urgente && tipo !== "correctivo")
    || !isValidDate(startDate)
    || (!urgente && (!isValidDate(endDate) || endDate < startDate || startDate < new Date().toISOString().slice(0, 10)))
    || startTime === undefined || endTime === undefined
    || ((startTime === null) !== (endTime === null))
    || (startTime && endTime && startTime >= endTime)
    || !motivo || motivo.length > 1000) {
    return res.status(400).json({ error: "Revisa tipo, motivo, fechas y horario del aviso" });
  }

  const client = await pool.connect();
  try {
    const vehicleIds = await getDriverVehicleIds(client, userId);
    if (!vehicleIds.includes(vehicleId)) {
      return res.status(403).json({ error: "El vehículo no está asignado a este conductor" });
    }

    await client.query("BEGIN");
    const vehicle = await client.query("SELECT id, placa FROM vehiculos WHERE id = $1 FOR UPDATE", [vehicleId]);
    if (!vehicle.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Vehículo no encontrado" });
    }

    const existing = await client.query(
      `SELECT id FROM vehiculo_indisponibilidades b
       WHERE b.vehiculo_id = $1 AND b.estado = 'activa'
         AND ${dateOverlapCondition}
       LIMIT 1`,
      [vehicleId, startDate, endDate || "9999-12-31", startTime, endTime]
    );
    if (existing.rowCount) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Ya existe un aviso de indisponibilidad para ese período" });
    }

    const conflicts = await findExistingTripConflicts(client, vehicleId, startDate, endDate, startTime, endTime);
    const saved = await client.query(
      `INSERT INTO vehiculo_indisponibilidades
         (vehiculo_id, tipo, urgente, fecha_inicio, fecha_fin, hora_inicio, hora_fin, motivo, creado_por, rol_creador)
       VALUES ($1, $2, $3, $4::date, $5::date, $6::time, $7::time, $8, $9, 'conductor')
       RETURNING id, vehiculo_id, tipo, urgente, fecha_inicio::text, fecha_fin::text,
                 hora_inicio::text, hora_fin::text, motivo, estado, creado_en`,
      [vehicleId, tipo, urgente, startDate, endDate, startTime, endTime, motivo, userId]
    );
    await client.query("COMMIT");

    await notificarAdmins(
      userId,
      `${urgente ? "Urgencia" : "Aviso"} de mantenimiento ${tipo} del vehículo ${vehicle.rows[0].placa}: ${motivo}${conflicts.length ? ` Hay ${conflicts.length} servicio(s) ya asignado(s) que se cruzan.` : ""}`
    );
    return res.status(201).json({
      message: conflicts.length
        ? "Aviso registrado y vehículo bloqueado para nuevas asignaciones. Hay servicios existentes que requieren coordinación."
        : "Aviso registrado y vehículo bloqueado para nuevas asignaciones.",
      indisponibilidad: saved.rows[0],
      conflictos: conflicts,
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error registrando indisponibilidad de mantenimiento:", error);
    return res.status(500).json({ error: "No se pudo registrar el aviso de mantenimiento" });
  } finally {
    client.release();
  }
};

const closeVehicleUnavailability = async (req: any, res: any) => {
  const id = Number(req.params.indisponibilidadId);
  const userId = Number(req.user?.id);
  const role = String(req.user?.rol || "").toLowerCase();
  const isAdmin = role === "admin";
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "ID de indisponibilidad inválido" });
  try {
    const result = await pool.query(
      `UPDATE vehiculo_indisponibilidades
       SET estado = 'cerrada', cerrado_por = $2, cerrado_en = CURRENT_TIMESTAMP, actualizado_en = CURRENT_TIMESTAMP
       WHERE id = $1 AND estado = 'activa'
         AND ($3::boolean OR creado_por = $2)
       RETURNING vehiculo_id, tipo, motivo`,
      [id, userId, isAdmin]
    );
    if (!result.rowCount) return res.status(404).json({ error: "Aviso activo no encontrado o no tienes permiso para cerrarlo" });

    const vehicleId = Number(result.rows[0].vehiculo_id);
    if (isAdmin) {
      const driverId = await getDriverUserForVehicle(pool, vehicleId);
      if (driverId) await crearNotificacion(userId, driverId, "Administración confirmó que el vehículo volvió a estar disponible.");
    } else {
      await notificarAdmins(userId, `El conductor informó que el vehículo volvió a estar operativo (aviso #${id}).`);
    }
    return res.json({ message: "Vehículo marcado como operativo" });
  } catch (error) {
    console.error("Error cerrando indisponibilidad del vehículo:", error);
    return res.status(500).json({ error: "No se pudo cerrar el aviso" });
  }
};

const listAdminVehicleUnavailability = async (_req: any, res: any) => {
  try {
    const result = await pool.query(
      `SELECT b.*, v.placa, v.modelo, creador.nombre AS creado_por_nombre,
              cerrador.nombre AS cerrado_por_nombre
       FROM vehiculo_indisponibilidades b
       JOIN vehiculos v ON v.id = b.vehiculo_id
       JOIN usuarios creador ON creador.id = b.creado_por
       LEFT JOIN usuarios cerrador ON cerrador.id = b.cerrado_por
       WHERE b.estado = 'activa' OR b.creado_en >= CURRENT_TIMESTAMP - INTERVAL '90 days'
       ORDER BY CASE WHEN b.estado = 'activa' THEN 0 ELSE 1 END, b.fecha_inicio DESC, b.id DESC
       LIMIT 300`
    );
    return res.json(result.rows);
  } catch (error) {
    console.error("Error listando indisponibilidades de vehículos:", error);
    return res.status(500).json({ error: "No se pudieron cargar las indisponibilidades" });
  }
};

const createAdminVehicleUnavailability = async (req: any, res: any) => {
  const vehicleId = Number(req.body?.vehiculo_id);
  const tipo = req.body?.tipo;
  const urgente = req.body?.urgente === true;
  const startDate = urgente ? new Date().toISOString().slice(0, 10) : req.body?.fecha_inicio;
  const endDate = urgente ? null : req.body?.fecha_fin;
  const startTime = parseTime(req.body?.hora_inicio);
  const endTime = parseTime(req.body?.hora_fin);
  const motivo = typeof req.body?.motivo === "string" ? req.body.motivo.trim() : "";
  const userId = Number(req.user?.id);
  if (!Number.isInteger(vehicleId) || vehicleId <= 0
    || !["preventivo", "correctivo", "otro"].includes(tipo)
    || (urgente && tipo !== "correctivo")
    || !isValidDate(startDate)
    || (!urgente && (!isValidDate(endDate) || endDate < startDate))
    || startTime === undefined || endTime === undefined
    || ((startTime === null) !== (endTime === null))
    || (startTime && endTime && startTime >= endTime)
    || !motivo || motivo.length > 1000) {
    return res.status(400).json({ error: "Revisa vehículo, motivo, fechas y horario del bloqueo" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const vehicle = await client.query("SELECT id, placa FROM vehiculos WHERE id = $1 FOR UPDATE", [vehicleId]);
    if (!vehicle.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Vehículo no encontrado" });
    }
    const existing = await client.query(
      `SELECT id FROM vehiculo_indisponibilidades b
       WHERE b.vehiculo_id = $1 AND b.estado = 'activa'
         AND ${dateOverlapCondition}
       LIMIT 1`,
      [vehicleId, startDate, endDate || "9999-12-31", startTime, endTime]
    );
    if (existing.rowCount) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Ya existe un aviso de indisponibilidad para ese período" });
    }
    const conflicts = await findExistingTripConflicts(client, vehicleId, startDate, endDate, startTime, endTime);
    const saved = await client.query(
      `INSERT INTO vehiculo_indisponibilidades
         (vehiculo_id, tipo, urgente, fecha_inicio, fecha_fin, hora_inicio, hora_fin, motivo, creado_por, rol_creador)
       VALUES ($1, $2, $3, $4::date, $5::date, $6::time, $7::time, $8, $9, 'admin')
       RETURNING id, vehiculo_id, tipo, urgente, fecha_inicio::text, fecha_fin::text,
                 hora_inicio::text, hora_fin::text, motivo, estado, creado_en`,
      [vehicleId, tipo, urgente, startDate, endDate, startTime, endTime, motivo, userId]
    );
    await client.query("COMMIT");

    const driverId = await getDriverUserForVehicle(pool, vehicleId);
    if (driverId) {
      await crearNotificacion(
        userId,
        driverId,
        `Administración marcó el vehículo ${vehicle.rows[0].placa} como no disponible: ${motivo}.`
      );
    }
    return res.status(201).json({
      message: conflicts.length
        ? "Bloqueo registrado. Hay servicios existentes que requieren coordinación."
        : "Bloqueo de disponibilidad registrado.",
      indisponibilidad: saved.rows[0],
      conflictos: conflicts,
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error creando bloqueo administrativo de vehículo:", error);
    return res.status(500).json({ error: "No se pudo registrar el bloqueo" });
  } finally {
    client.release();
  }
};

module.exports = {
  listDriverVehicleUnavailability,
  createDriverVehicleUnavailability,
  closeVehicleUnavailability,
  listAdminVehicleUnavailability,
  createAdminVehicleUnavailability,
};
