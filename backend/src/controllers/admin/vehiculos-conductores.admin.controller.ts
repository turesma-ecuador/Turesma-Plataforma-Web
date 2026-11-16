export {};

const pool = require("../../config/db");
const bcrypt = require("bcrypt");

const parsePositiveInt = (value) => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
};

const parseDiasServicio = (value) => {
  if (!Array.isArray(value)) return null;

  const cleaned = Array.from(
    new Set(
      value
        .map((day) => Number(day))
        .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)
    )
  ).sort((a, b) => a - b);

  if (cleaned.length === 0) return null;
  return cleaned;
};

const normalizeDateInput = (value) => {
  if (!value) return null;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
};

const getDateRange = (desde, hasta) => {
  const start = normalizeDateInput(desde) || new Date().toISOString().slice(0, 10);
  const end = normalizeDateInput(hasta);

  if (end && end >= start) {
    return { start, end };
  }

  const fallback = new Date(start);
  fallback.setDate(fallback.getDate() + 30);
  return { start, end: fallback.toISOString().slice(0, 10) };
};

const getVehiculoDisponibilidad = async (vehiculoId, desde, hasta) => {
  const range = getDateRange(desde, hasta);

  const result = await pool.query(
    `SELECT
       s.fecha,
       CASE
         WHEN vd.disponible IS NOT NULL THEN vd.disponible
         WHEN EXTRACT(DOW FROM s.fecha)::INT = ANY(COALESCE(v.dias_servicio, ARRAY[0,1,2,3,4,5,6]))
              AND r.id IS NULL
         THEN true
         ELSE false
       END AS disponible,
       vd.nota,
       CASE
         WHEN r.id IS NOT NULL THEN 'reservado'
         WHEN vd.disponible IS NOT NULL THEN 'ajuste_manual'
         WHEN EXTRACT(DOW FROM s.fecha)::INT = ANY(COALESCE(v.dias_servicio, ARRAY[0,1,2,3,4,5,6])) THEN 'dia_habil'
         ELSE 'dia_no_habil'
       END AS motivo
     FROM vehiculos v
     CROSS JOIN LATERAL generate_series($2::date, $3::date, interval '1 day') AS s(fecha)
     LEFT JOIN vehiculo_disponibilidad vd
       ON vd.vehiculo_id = v.id
      AND vd.fecha = s.fecha::date
     LEFT JOIN LATERAL (
       SELECT id
       FROM reservas
       WHERE vehiculo_id = v.id
         AND fecha_reserva = s.fecha::date
         AND estado NOT IN ('cancelada', 'finalizada')
       LIMIT 1
     ) r ON true
     WHERE v.id = $1
       AND v.activo = true
     ORDER BY s.fecha ASC`,
    [vehiculoId, range.start, range.end]
  );

  return result.rows;
};

const listarVehiculos = async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT
         v.id,
         v.placa,
         v.usuario_id,
         v.tipo,
         v.modelo,
         v.capacidad,
         v.color,
         v.imagen_url,
         v.descripcion,
         COALESCE(v.dias_servicio, ARRAY[0,1,2,3,4,5,6]) AS dias_servicio,
         v.estado,
         v.activo,
         v.orden,
         v.fecha_creacion,
         c.id       AS conductor_id,
         u.nombre   AS conductor_nombre,
         u.email    AS conductor_email,
         u.activo   AS conductor_activo,
         COALESCE(rv.viajes_realizados, 0)::int AS viajes_realizados
       FROM vehiculos v
       LEFT JOIN usuarios u
         ON u.id = v.usuario_id
        AND LOWER(u.rol) = 'vehiculo'
       LEFT JOIN conductores c
         ON c.usuario_id = v.usuario_id
       LEFT JOIN LATERAL (
         SELECT COUNT(*)::int AS viajes_realizados
         FROM reservas r
         WHERE r.vehiculo_id = v.id
           AND r.estado NOT IN ('cancelada')
       ) rv ON true
      ORDER BY v.orden ASC NULLS LAST, v.id DESC`
    );

    return res.status(200).json(result.rows);
  } catch (error) {
    console.error("Error listando vehículos:", error);
    return res.status(500).json({ error: "Error interno del servidor" });
  }
};

const registrarVehiculo = async (req, res) => {
  const { placa, tipo, modelo, capacidad, estado, color, imagen_url, descripcion, usuario_id, dias_servicio } = req.body;
  const capacidadInt = parsePositiveInt(capacidad);
  const usuarioId = usuario_id ? parsePositiveInt(usuario_id) : null;
  const diasServicio = parseDiasServicio(dias_servicio) || [0, 1, 2, 3, 4, 5, 6];

  if (!placa || !modelo || !capacidadInt) {
    return res.status(400).json({ error: "Debes enviar placa, modelo y capacidad válidos" });
  }

  try {
    const result = await pool.query(
      `INSERT INTO vehiculos (placa, orden, usuario_id, tipo, modelo, capacidad, color, imagen_url, descripcion, dias_servicio, estado, activo)
       VALUES ($1, COALESCE((SELECT MAX(orden) + 1 FROM vehiculos WHERE activo = true), 1), $2, $3, $4, $5, $6, $7, $8, $9, $10, true)
       RETURNING *`,
      [
        placa.toUpperCase(),
        usuarioId,
        tipo || "van",
        modelo,
        capacidadInt,
        color || null,
        imagen_url || null,
        descripcion || null,
        diasServicio,
        estado || "disponible",
      ]
    );

    const nuevoVehiculo = result.rows[0];

    // Un conductor puede quedar asociado a varios vehículos. La asignación
    // histórica se mantiene por vehículo y no se cierran sus otros vínculos.
    if (usuarioId) {
      const conductorRow = await pool.query(`SELECT id FROM conductores WHERE usuario_id = $1 LIMIT 1`, [usuarioId]);
      const conductorId = conductorRow.rowCount ? conductorRow.rows[0].id : null;
      if (conductorId) {
        const vehicleState = await pool.query("SELECT estado, activo FROM vehiculos WHERE id = $1", [nuevoVehiculo.id]);
        if (vehicleState.rows[0]?.activo && vehicleState.rows[0]?.estado !== "mantenimiento") {
          await pool.query(
            `INSERT INTO asignacion_vehiculos (conductor_id, vehiculo_id, estado)
             VALUES ($1, $2, 'activa')
             ON CONFLICT (vehiculo_id) WHERE estado = 'activa'
             DO UPDATE SET conductor_id = EXCLUDED.conductor_id,
                           actualizado_en = CURRENT_TIMESTAMP`,
            [conductorId, nuevoVehiculo.id]
          );
        }
      }
    }

    return res.status(201).json({
      message: "Vehículo registrado correctamente",
      vehiculo: nuevoVehiculo,
    });
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({ error: "La placa ya está registrada" });
    }

    console.error("Error registrando vehículo:", error);
    return res.status(500).json({ error: "Error interno del servidor" });
  }
};

const editarVehiculo = async (req, res) => {
  const vehiculoId = parsePositiveInt(req.params.id);

  if (!vehiculoId) {
    return res.status(400).json({ error: "ID de vehículo inválido" });
  }

  try {
    const currentResult = await pool.query("SELECT * FROM vehiculos WHERE id = $1 LIMIT 1", [vehiculoId]);

    if (currentResult.rowCount === 0) {
      return res.status(404).json({ error: "Vehículo no encontrado" });
    }

    const current = currentResult.rows[0];
    const capacidadInt = req.body.capacidad
      ? parsePositiveInt(req.body.capacidad)
      : Number(current.capacidad);
    const usuarioId = req.body.usuario_id
      ? parsePositiveInt(req.body.usuario_id)
      : req.body.usuario_id === null
        ? null
        : current.usuario_id;
    const diasServicio = parseDiasServicio(req.body.dias_servicio) || current.dias_servicio || [0, 1, 2, 3, 4, 5, 6];

    if (!capacidadInt) {
      return res.status(400).json({ error: "Capacidad inválida" });
    }

    // La relación directa conserva el vehículo asociado en la ficha. La tabla
    // de asignaciones conserva además todos los vínculos históricos del conductor.
    const conductorCambio = usuarioId !== current.usuario_id;
    if (conductorCambio) {
      // Solo se cierra la asignación activa de este vehículo.
      await pool.query(
        `UPDATE asignacion_vehiculos SET estado = 'finalizada', fecha_fin = CURRENT_DATE, actualizado_en = CURRENT_TIMESTAMP
         WHERE vehiculo_id = $1 AND estado = 'activa'`,
        [vehiculoId]
      );

      if (usuarioId) {
        const conductorRow = await pool.query(`SELECT id FROM conductores WHERE usuario_id = $1 LIMIT 1`, [usuarioId]);
        const conductorId = conductorRow.rowCount ? conductorRow.rows[0].id : null;
        if (conductorId) {
          await pool.query(
            `INSERT INTO asignacion_vehiculos (conductor_id, vehiculo_id, estado)
             VALUES ($1, $2, 'activa')
             ON CONFLICT (vehiculo_id) WHERE estado = 'activa'
             DO UPDATE SET conductor_id = EXCLUDED.conductor_id,
                           actualizado_en = CURRENT_TIMESTAMP`,
            [conductorId, vehiculoId]
          );
        }
      }
    }

    const result = await pool.query(
      `UPDATE vehiculos
       SET placa = $1,
           usuario_id = $2,
           tipo = $3,
           modelo = $4,
           capacidad = $5,
           color = $6,
           imagen_url = $7,
           descripcion = $8,
           dias_servicio = $9,
           estado = $10,
           activo = $11
       WHERE id = $12
       RETURNING *`,
      [
        (req.body.placa || current.placa).toUpperCase(),
        usuarioId,
        req.body.tipo || current.tipo,
        req.body.modelo || current.modelo,
        capacidadInt,
        req.body.color ?? current.color,
        req.body.imagen_url ?? current.imagen_url,
        req.body.descripcion ?? current.descripcion,
        diasServicio,
        req.body.estado || current.estado,
        typeof req.body.activo === "boolean" ? req.body.activo : current.activo,
        vehiculoId,
      ]
    );

    return res.status(200).json({
      message: "Vehículo actualizado correctamente",
      vehiculo: result.rows[0],
    });
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({ error: "La placa ya está registrada" });
    }

    console.error("Error editando vehículo:", error);
    return res.status(500).json({ error: "Error interno del servidor" });
  }
};

const eliminarVehiculo = async (req, res) => {
  const vehiculoId = parsePositiveInt(req.params.id);

  if (!vehiculoId) {
    return res.status(400).json({ error: "ID de vehículo inválido" });
  }

  try {
    const result = await pool.query(
      "UPDATE vehiculos SET activo = false WHERE id = $1 RETURNING id",
      [vehiculoId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Vehículo no encontrado" });
    }

    return res.status(200).json({ message: "Vehículo eliminado correctamente" });
  } catch (error) {
    console.error("Error eliminando vehículo:", error);
    return res.status(500).json({ error: "Error interno del servidor" });
  }
};

const reordenarVehiculos = async (req, res) => {
  const vehiculoIds = Array.isArray(req.body?.vehiculoIds) ? req.body.vehiculoIds : null;
  const ids = vehiculoIds?.map(parsePositiveInt);

  if (!ids || ids.length === 0 || ids.some((id) => !id) || new Set(ids).size !== ids.length) {
    return res.status(400).json({ error: "Debes enviar una lista válida de vehículos" });
  }

  try {
    const result = await pool.query(
      `UPDATE vehiculos v
       SET orden = orden_data.orden
       FROM unnest($1::int[], $2::int[]) AS orden_data(id, orden)
       WHERE v.id = orden_data.id
         AND v.activo = true
       RETURNING v.id`,
      [ids, ids.map((_, index) => index + 1)]
    );

    if (result.rowCount !== ids.length) {
      return res.status(400).json({ error: "La lista contiene vehículos inválidos" });
    }

    return res.status(200).json({ message: "Orden de vehículos actualizado" });
  } catch (error) {
    console.error("Error reordenando vehículos:", error);
    return res.status(500).json({ error: "Error interno del servidor" });
  }
};

const verVehiculosDisponibles = async (req, res) => {
  const fecha = req.query.fecha;

  if (!fecha) {
    return res.status(400).json({ error: "Debes enviar fecha en query (?fecha=YYYY-MM-DD)" });
  }

  try {
    const result = await pool.query(
      `SELECT
         v.id,
         v.placa,
         v.tipo,
         v.modelo,
         v.capacidad,
         v.color,
         v.imagen_url,
         v.descripcion,
         COALESCE(v.dias_servicio, ARRAY[0,1,2,3,4,5,6]) AS dias_servicio,
         u.id AS conductor_id,
         u.nombre AS conductor_nombre
       FROM vehiculos v
       LEFT JOIN usuarios u ON u.id = v.usuario_id
       WHERE v.activo = true
         AND v.estado = 'disponible'
         AND COALESCE(
           (
             SELECT vd.disponible
             FROM vehiculo_disponibilidad vd
             WHERE vd.vehiculo_id = v.id
               AND vd.fecha = $1::date
             LIMIT 1
           ),
           EXTRACT(DOW FROM $1::date)::INT = ANY(COALESCE(v.dias_servicio, ARRAY[0,1,2,3,4,5,6]))
         ) = true
         AND NOT EXISTS (
           SELECT 1
           FROM vehiculo_indisponibilidades b
           WHERE b.vehiculo_id = v.id
             AND b.estado = 'activa'
             AND b.fecha_inicio <= $1::date
             AND COALESCE(b.fecha_fin, 'infinity'::date) >= $1::date
         )
         AND NOT EXISTS (
           SELECT 1
           FROM reservas r
           WHERE r.vehiculo_id = v.id
             AND r.fecha_reserva = $1::date
            AND r.estado NOT IN ('cancelada', 'finalizada')
         )
       ORDER BY v.id ASC`,
      [fecha]
    );

    return res.status(200).json(result.rows);
  } catch (error) {
    console.error("Error listando vehículos disponibles:", error);
    return res.status(500).json({ error: "Error interno del servidor" });
  }
};

const listarConductores = async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT
         u.id,
         u.nombre,
         u.email,
         u.telefono,
         u.activo,
         u.creado_en,
         u.imagen_url AS foto_conductor,
         c.licencia,
         c.estado,
         c.fecha_licencia_vencimiento,
         c.fecha_certificado_seguridad,
         c.rating_promedio,
         c.viajes_completados,
         c.viajes_cancelados,
         c.horas_conduccion,
         c.estado_documentos
       FROM usuarios u
       LEFT JOIN conductores c
         ON c.usuario_id = u.id
       WHERE LOWER(u.rol) = 'vehiculo'
       ORDER BY u.id DESC`
    );

    return res.status(200).json(result.rows);
  } catch (error) {
    console.error("Error listando conductores:", error);
    return res.status(500).json({ error: "Error interno del servidor" });
  }
};

const registrarConductor = async (req, res) => {
  const {
    nombre,
    email: rawEmail,
    password,
    telefono,
    licencia,
    licencia_tipo,
    estado,
    fecha_licencia_vencimiento,
    estado_documentos,
    rating_promedio,
    viajes_completados,
    viajes_cancelados,
    horas_conduccion,
    foto_conductor,
  } = req.body;

  if (!nombre || !rawEmail || !password) {
    return res.status(400).json({ error: "Debes enviar nombre, email y password" });
  }

  const email = String(rawEmail).trim();

  try {
    const passwordHash = await bcrypt.hash(password, 10);

    // Verificación explícita de email (case-insensitive)
    const existing = await pool.query("SELECT id FROM usuarios WHERE LOWER(email) = LOWER($1) LIMIT 1", [email]);
    if (existing.rowCount) {
      return res.status(409).json({ error: "El email ya está registrado" });
    }

    const result = await pool.query(
      `INSERT INTO usuarios (nombre, email, password_hash, rol, telefono, imagen_url, activo)
       VALUES ($1, $2, $3, 'vehiculo', $4, $5, true)
       RETURNING id, nombre, email, rol, telefono, imagen_url, activo, creado_en`,
      [nombre, email, passwordHash, telefono || null, (foto_conductor && String(foto_conductor).trim()) || null]
    );

    const userId = result.rows[0].id;
    const licenciaValue = String(licencia_tipo || licencia || `LIC-${userId}`).trim();

    await pool.query(
      `INSERT INTO conductores (
         usuario_id,
         licencia,
         telefono,
         estado,
         fecha_licencia_vencimiento,
         estado_documentos,
         rating_promedio,
         viajes_completados,
         viajes_cancelados,
         horas_conduccion
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (usuario_id) DO UPDATE SET
         licencia = EXCLUDED.licencia,
         telefono = EXCLUDED.telefono,
         estado = EXCLUDED.estado,
         fecha_licencia_vencimiento = EXCLUDED.fecha_licencia_vencimiento,
         estado_documentos = EXCLUDED.estado_documentos,
         rating_promedio = EXCLUDED.rating_promedio,
         viajes_completados = EXCLUDED.viajes_completados,
         viajes_cancelados = EXCLUDED.viajes_cancelados,
         horas_conduccion = EXCLUDED.horas_conduccion`,
      [
        userId,
        licenciaValue,
        telefono || null,
        estado || "disponible",
        fecha_licencia_vencimiento || null,
        estado_documentos || "completos",
        rating_promedio ?? 5.0,
        viajes_completados ?? 0,
        viajes_cancelados ?? 0,
        horas_conduccion ?? 0,
      ]
    );

    return res.status(201).json({
      message: "Conductor registrado correctamente",
      conductor: result.rows[0],
    });
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({ error: "El email ya está registrado" });
    }

    console.error("Error registrando conductor:", error);
    return res.status(500).json({ error: "Error interno del servidor" });
  }
};

const editarConductor = async (req, res) => {
  const conductorId = parsePositiveInt(req.params.id);

  if (!conductorId) {
    return res.status(400).json({ error: "ID de conductor inválido" });
  }

  try {
    const currentResult = await pool.query(
      `SELECT
         u.id,
         u.nombre,
         u.email,
         u.telefono,
         u.activo,
         u.password_hash,
         u.imagen_url,
         c.licencia,
         c.estado,
         c.fecha_licencia_vencimiento,
         c.estado_documentos,
         c.rating_promedio,
         c.viajes_completados,
         c.viajes_cancelados,
         c.horas_conduccion
       FROM usuarios u
       LEFT JOIN conductores c
         ON c.usuario_id = u.id
       WHERE u.id = $1 AND LOWER(u.rol) = 'vehiculo' LIMIT 1`,
      [conductorId]
    );

    if (currentResult.rowCount === 0) {
      return res.status(404).json({ error: "Conductor no encontrado" });
    }

    const current = currentResult.rows[0];
    const passwordHash = req.body.password
      ? await bcrypt.hash(req.body.password, 10)
      : current.password_hash;
    const licenciaValue = String(req.body.licencia_tipo || req.body.licencia || current.licencia || `LIC-${conductorId}`).trim();
    const estadoValue = req.body.estado || current.estado || "disponible";

    const result = await pool.query(
      `UPDATE usuarios
       SET nombre = $1,
           email = $2,
           password_hash = $3,
           telefono = $4,
           activo = $5,
           imagen_url = $6
       WHERE id = $7
       RETURNING id, nombre, email, activo, rol, imagen_url, creado_en`,
      [
        req.body.nombre || current.nombre,
        req.body.email || current.email,
        passwordHash,
        req.body.telefono ?? current.telefono ?? null,
        typeof req.body.activo === "boolean" ? req.body.activo : current.activo,
        (req.body.foto_conductor && String(req.body.foto_conductor).trim()) || current.imagen_url || null,
        conductorId,
      ]
    );

    await pool.query(
      `INSERT INTO conductores (
         usuario_id,
         licencia,
         telefono,
         estado,
         fecha_licencia_vencimiento,
         estado_documentos,
         rating_promedio,
         viajes_completados,
         viajes_cancelados,
         horas_conduccion
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (usuario_id) DO UPDATE SET
         licencia = EXCLUDED.licencia,
         telefono = EXCLUDED.telefono,
         estado = EXCLUDED.estado,
         fecha_licencia_vencimiento = EXCLUDED.fecha_licencia_vencimiento,
         estado_documentos = EXCLUDED.estado_documentos,
         rating_promedio = EXCLUDED.rating_promedio,
         viajes_completados = EXCLUDED.viajes_completados,
         viajes_cancelados = EXCLUDED.viajes_cancelados,
         horas_conduccion = EXCLUDED.horas_conduccion`,
      [
        conductorId,
        licenciaValue,
        req.body.telefono ?? current.telefono ?? null,
        estadoValue,
        req.body.fecha_licencia_vencimiento ?? current.fecha_licencia_vencimiento ?? null,
        req.body.estado_documentos ?? current.estado_documentos ?? "completos",
        req.body.rating_promedio ?? current.rating_promedio ?? 5.0,
        req.body.viajes_completados ?? current.viajes_completados ?? 0,
        req.body.viajes_cancelados ?? current.viajes_cancelados ?? 0,
        req.body.horas_conduccion ?? current.horas_conduccion ?? 0,
      ]
    );

    return res.status(200).json({
      message: "Conductor actualizado correctamente",
      conductor: result.rows[0],
    });
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({ error: "El email ya está registrado" });
    }

    console.error("Error editando conductor:", error);
    return res.status(500).json({ error: "Error interno del servidor" });
  }
};

const eliminarConductor = async (req, res) => {
  const conductorId = parsePositiveInt(req.params.id);

  if (!conductorId) {
    return res.status(400).json({ error: "ID de conductor inválido" });
  }

  try {
    const result = await pool.query(
      "UPDATE usuarios SET activo = false WHERE id = $1 AND LOWER(rol) = 'vehiculo' RETURNING id",
      [conductorId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Conductor no encontrado" });
    }

    return res.status(200).json({ message: "Conductor eliminado correctamente" });
  } catch (error) {
    console.error("Error eliminando conductor:", error);
    return res.status(500).json({ error: "Error interno del servidor" });
  }
};

const verConductoresDisponibles = async (req, res) => {
  const fecha = req.query.fecha;

  if (!fecha) {
    return res.status(400).json({ error: "Debes enviar fecha en query (?fecha=YYYY-MM-DD)" });
  }

  try {
    const result = await pool.query(
      `SELECT c.id, c.nombre, c.email
       FROM usuarios c
       WHERE LOWER(c.rol) = 'vehiculo'
         AND c.activo = true
         AND NOT EXISTS (
           SELECT 1
           FROM reservas r
           WHERE r.conductor_id = c.id
             AND r.fecha_reserva = $1
               AND r.estado NOT IN ('cancelada', 'finalizada')
         )
       ORDER BY c.nombre ASC`,
      [fecha]
    );

    return res.status(200).json(result.rows);
  } catch (error) {
    console.error("Error listando conductores disponibles:", error);
    return res.status(500).json({ error: "Error interno del servidor" });
  }
};

const obtenerDisponibilidadVehiculo = async (req, res) => {
  const vehiculoId = parsePositiveInt(req.params.id);

  if (!vehiculoId) {
    return res.status(400).json({ error: "ID de vehículo inválido" });
  }

  try {
    const disponibilidad = await getVehiculoDisponibilidad(
      vehiculoId,
      req.query.desde,
      req.query.hasta
    );

    return res.status(200).json(disponibilidad);
  } catch (error) {
    console.error("Error obteniendo disponibilidad de vehículo:", error);
    return res.status(500).json({ error: "Error interno del servidor" });
  }
};

const actualizarDisponibilidadVehiculo = async (req, res) => {
  const vehiculoId = parsePositiveInt(req.params.id);

  if (!vehiculoId) {
    return res.status(400).json({ error: "ID de vehículo inválido" });
  }

  const payload = Array.isArray(req.body?.disponibilidad) ? req.body.disponibilidad : null;
  if (!payload || payload.length === 0) {
    return res.status(400).json({
      error: "Debes enviar disponibilidad como arreglo de objetos { fecha, disponible, nota? }",
    });
  }

  try {
    const vehiculoResult = await pool.query(
      "SELECT id FROM vehiculos WHERE id = $1 AND activo = true LIMIT 1",
      [vehiculoId]
    );

    if (vehiculoResult.rowCount === 0) {
      return res.status(404).json({ error: "Vehículo no encontrado" });
    }

    for (const item of payload) {
      const fecha = normalizeDateInput(item?.fecha);
      const disponible = typeof item?.disponible === "boolean" ? item.disponible : null;
      const nota = typeof item?.nota === "string" ? item.nota.trim().slice(0, 255) : null;

      if (!fecha || disponible === null) {
        return res.status(400).json({
          error: "Cada item de disponibilidad requiere fecha válida y disponible booleano",
        });
      }

      await pool.query(
        `INSERT INTO vehiculo_disponibilidad (vehiculo_id, fecha, disponible, nota, actualizado_en)
         VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
         ON CONFLICT (vehiculo_id, fecha)
         DO UPDATE SET
           disponible = EXCLUDED.disponible,
           nota = EXCLUDED.nota,
           actualizado_en = CURRENT_TIMESTAMP`,
        [vehiculoId, fecha, disponible, nota]
      );
    }

    const disponibilidad = await getVehiculoDisponibilidad(
      vehiculoId,
      req.query.desde,
      req.query.hasta
    );

    return res.status(200).json({
      message: "Disponibilidad actualizada correctamente",
      disponibilidad,
    });
  } catch (error) {
    console.error("Error actualizando disponibilidad del vehículo:", error);
    return res.status(500).json({ error: "Error interno del servidor" });
  }
};

const verDisponibilidad = async (req, res) => {
  const fecha = req.query.fecha;

  if (!fecha) {
    return res.status(400).json({ error: "Debes enviar la fecha en query (?fecha=YYYY-MM-DD)" });
  }

  try {
    const [toursResult, vehiculosResult, conductoresResult] = await Promise.all([
      pool.query(
        `SELECT
           t.id,
           t.titulo,
           t.capacidad,
           COALESCE(SUM(r.num_personas), 0) AS personas_reservadas
         FROM tours t
         LEFT JOIN reservas r
           ON r.tour_id = t.id
           AND r.fecha_reserva = $1
           AND r.estado NOT IN ('cancelada', 'finalizada')
         WHERE t.activo = true
         GROUP BY t.id, t.titulo, t.capacidad
         ORDER BY t.id ASC`,
        [fecha]
      ),
      pool.query(
        `SELECT v.id, v.placa, v.tipo, v.modelo, v.capacidad
         FROM vehiculos v
         WHERE v.activo = true
           AND v.estado = 'disponible'
           AND COALESCE(
             (
               SELECT vd.disponible
               FROM vehiculo_disponibilidad vd
               WHERE vd.vehiculo_id = v.id
                 AND vd.fecha = $1::date
               LIMIT 1
             ),
             EXTRACT(DOW FROM $1::date)::INT = ANY(COALESCE(v.dias_servicio, ARRAY[0,1,2,3,4,5,6]))
           ) = true
           AND NOT EXISTS (
             SELECT 1
             FROM reservas r
             WHERE r.vehiculo_id = v.id
               AND r.fecha_reserva = $1::date
               AND r.estado NOT IN ('cancelada', 'finalizada')
           )
         ORDER BY v.id ASC`,
        [fecha]
      ),
      pool.query(
        `SELECT c.id, c.nombre, c.email
         FROM usuarios c
         WHERE LOWER(c.rol) = 'vehiculo'
           AND c.activo = true
           AND NOT EXISTS (
             SELECT 1
             FROM reservas r
             WHERE r.conductor_id = c.id
               AND r.fecha_reserva = $1
               AND r.estado NOT IN ('cancelada', 'finalizada')
           )
         ORDER BY c.nombre ASC`,
        [fecha]
      ),
    ]);

    const tours = toursResult.rows.map((row) => {
      const capacidadTotal = Number(row.capacidad || 0);
      const personasReservadas = Number(row.personas_reservadas || 0);

      return {
        id: row.id,
        titulo: row.titulo,
        capacidad_total: capacidadTotal,
        personas_reservadas: personasReservadas,
        cupos_disponibles: Math.max(capacidadTotal - personasReservadas, 0),
      };
    });

    return res.status(200).json({
      fecha,
      tours,
      vehiculos_disponibles: vehiculosResult.rows,
      conductores_disponibles: conductoresResult.rows,
    });
  } catch (error) {
    console.error("Error viendo disponibilidad:", error);
    return res.status(500).json({ error: "Error interno del servidor" });
  }
};

module.exports = {
  listarVehiculos,
  registrarVehiculo,
  editarVehiculo,
  eliminarVehiculo,
  reordenarVehiculos,
  verVehiculosDisponibles,
  listarConductores,
  registrarConductor,
  editarConductor,
  eliminarConductor,
  verConductoresDisponibles,
  verDisponibilidad,
  obtenerDisponibilidadVehiculo,
  actualizarDisponibilidadVehiculo,
};
