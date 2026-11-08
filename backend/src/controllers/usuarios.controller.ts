export {};

const pool = require("../config/db");

const bcrypt = require("bcrypt");
const { normalizeRole } = require("../config/catalogoHelpers");
const { enviarCorreoBienvenida } = require("../config/usuarioMailer");
const { notificarReprogramacion } = require("../config/reservaMailer");
const { getPricing } = require("../config/pricing");

const recordReservationHistory = async (
  client: any,
  reservaId: number,
  userId: number,
  accion: string,
  estadoAnterior: string | null,
  estadoNuevo: string | null,
  detalle: Record<string, unknown> = {}
) => {
  await client.query(
    `INSERT INTO reserva_historial (reserva_id, usuario_id, accion, estado_anterior, estado_nuevo, detalle)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
    [reservaId, userId, accion, estadoAnterior, estadoNuevo, JSON.stringify(detalle)]
  );
};

const dateOnly = (value: unknown) => {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const text = String(value);
  return /^\d{4}-\d{2}-\d{2}/.exec(text)?.[0] || null;
};

const shiftDate = (date: string, days: number) => {
  const shifted = new Date(`${date}T00:00:00.000Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
};

const dateDifference = (from: string, to: string) => {
  const fromDate = new Date(`${from}T00:00:00.000Z`);
  const toDate = new Date(`${to}T00:00:00.000Z`);
  return Math.round((toDate.getTime() - fromDate.getTime()) / 86400000);
};

const listarTarifasCliente = async (_req: any, res: any) => {
  try {
    const pricing = await getPricing();
    res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.set("Pragma", "no-cache");
    res.set("Expires", "0");
    return res.json({
      tarifa_diaria: Number(pricing.tarifa_diaria),
      precio_km: Number(pricing.precio_km),
      tarifa_viaje: Number(pricing.tarifa_viaje),
      recargo_peajes: Number(pricing.recargo_peajes),
      minimo_km: Number(pricing.minimo_km),
      tarifa_van: Number(pricing.tarifa_van || pricing.tarifa_diaria || 0),
      tarifa_bus: Number(pricing.tarifa_bus || pricing.tarifa_diaria || 0),
      tarifa_suv: Number(pricing.tarifa_suv || pricing.tarifa_diaria || 0),
      tarifa_minibus: Number(pricing.tarifa_minibus || pricing.tarifa_diaria || 0),
      tarifa_sedan: Number(pricing.tarifa_sedan || pricing.tarifa_diaria || 0),
      traslado_van: Number(pricing.traslado_van || 0), traslado_bus: Number(pricing.traslado_bus || 0),
      traslado_suv: Number(pricing.traslado_suv || 0), traslado_minibus: Number(pricing.traslado_minibus || 0), traslado_sedan: Number(pricing.traslado_sedan || 0),
      hora_van: Number(pricing.hora_van || 0), hora_bus: Number(pricing.hora_bus || 0),
      hora_suv: Number(pricing.hora_suv || 0), hora_minibus: Number(pricing.hora_minibus || 0), hora_sedan: Number(pricing.hora_sedan || 0),
      medio_dia_van: Number(pricing.medio_dia_van || 0), medio_dia_bus: Number(pricing.medio_dia_bus || 0),
      medio_dia_suv: Number(pricing.medio_dia_suv || 0), medio_dia_minibus: Number(pricing.medio_dia_minibus || 0), medio_dia_sedan: Number(pricing.medio_dia_sedan || 0),
      oferta_activa: Boolean(pricing.oferta_activa),
      oferta_dia: pricing.oferta_dia || "lunes",
      descuento_oferta_pct: Number(pricing.descuento_oferta_pct || 0),
      oferta_descripcion: pricing.oferta_descripcion || "",
    });
  } catch (error) {
    console.error("Error listando tarifas públicas:", error);
    return res.status(500).json({ error: "No se pudieron obtener las tarifas" });
  }
};

const crearUsuario = async (req, res) => {
  const { nombre, email: rawEmail, password, rol } = req.body;

  if (!nombre || !rawEmail || !password) {
    return res.status(400).json({ error: "Debes enviar nombre, email y password" });
  }

  const email = String(rawEmail).trim();
  const normalizedRole = await normalizeRole(rol || "cliente");

  if (!normalizedRole) {
    return res.status(400).json({ error: "Rol inválido. Debe ser admin, cliente, operativo o vehiculo" });
  }

  try {
    const exists = await pool.query(
      "SELECT id FROM usuarios WHERE LOWER(email) = LOWER($1) LIMIT 1",
      [email]
    );

    if (exists.rowCount) {
      return res.status(409).json({ error: "El email ya está registrado" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const insertResult = await pool.query(
      "INSERT INTO usuarios (nombre, email, password_hash, rol) VALUES ($1, $2, $3, $4) RETURNING id, nombre, email, rol, creado_en",
      [nombre, email, hashedPassword, normalizedRole]
    );

    // Correo de bienvenida a los clientes recién registrados (best-effort).
    if (normalizedRole === "cliente") {
      await enviarCorreoBienvenida({ email, nombre });
    }

    return res.status(201).json({ message: "Usuario guardado correctamente", user: insertResult.rows[0] });
  } catch (error) {
    console.error("Error creando usuario:", error);

    if (error && error.code === "23505") {
      return res.status(409).json({ error: "El email ya está registrado" });
    }

    return res.status(500).json({ error: "Error interno del servidor" });
  }
};

const listarUsuarios = async (_req, res) => {
  try {
    const result = await pool.query(
      "SELECT id, nombre, email, rol, creado_en FROM usuarios ORDER BY id ASC"
    );

    return res.status(200).json(result.rows);
  } catch (error) {
    console.error("Error listando usuarios:", error);
    return res.status(500).json({ error: "Error interno del servidor" });
  }
};

const listarVehiculosCliente = async (req, res) => {
  const fecha = req.query.fecha;

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
         v.estado,
         v.orden,
         u.id AS conductor_id,
         u.nombre AS conductor_nombre,
         u.telefono AS conductor_telefono,
         CASE
           WHEN $1::text IS NULL THEN NULL
           ELSE (
             v.activo = true
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
                   AND (r.fecha_reserva = $1::date OR r.fecha_regreso = $1::date)
                 AND r.estado NOT IN ('cancelada', 'finalizada')
             )
           )
         END AS disponible_en_fecha
       FROM vehiculos v
       LEFT JOIN usuarios u
         ON u.id = v.usuario_id
       WHERE v.activo = true
      ORDER BY v.orden ASC NULLS LAST, v.id DESC`,
      [fecha || null]
    );

    res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.set("Pragma", "no-cache");
    res.set("Expires", "0");
    return res.status(200).json(result.rows);
  } catch (error) {
    console.error("Error listando vehiculos para cliente:", error);
    return res.status(500).json({ error: "Error interno del servidor" });
  }
};

const recomendarVehiculo = async (req: any, res: any) => {
  const rawPersonas = Number(req.body?.num_personas);
  const personas = Number.isFinite(rawPersonas) ? Math.max(1, Math.floor(rawPersonas)) : 1;
  const notas = String(req.body?.notas || "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const fechaInicio = typeof req.body?.fecha_servicio === "string" ? req.body.fecha_servicio : null;
  const fechaRegreso = typeof req.body?.fecha_regreso === "string" ? req.body.fecha_regreso : null;
  const fechaFin = typeof req.body?.fecha_fin === "string" && req.body.fecha_fin >= fechaInicio
    ? req.body.fecha_fin
    : fechaInicio;
  const tipoPreferido = String(req.body?.tipo_vehiculo || "").trim().toLowerCase();

  if (fechaInicio && !/^\d{4}-\d{2}-\d{2}$/.test(fechaInicio)) {
    return res.status(400).json({ error: "La fecha del servicio no es válida" });
  }
  if (fechaRegreso && (!/^\d{4}-\d{2}-\d{2}$/.test(fechaRegreso) || !fechaInicio || fechaRegreso <= fechaInicio)) {
    return res.status(400).json({ error: "La fecha de regreso debe ser posterior a la fecha de salida" });
  }

  try {
    const result = await pool.query(
      `SELECT v.id, v.placa, v.tipo, v.modelo, v.capacidad, v.imagen_url, v.descripcion,
              COALESCE(v.dias_servicio, ARRAY[0,1,2,3,4,5,6]) AS dias_servicio
       FROM vehiculos v
       WHERE v.activo = true
         AND v.estado = 'disponible'
         AND v.capacidad >= $1
         AND ($2::text IS NULL OR NOT EXISTS (
           SELECT 1 FROM generate_series($2::date, $3::date, interval '1 day') AS dias(fecha)
           WHERE NOT (
             EXTRACT(DOW FROM dias.fecha)::INT = ANY(COALESCE(v.dias_servicio, ARRAY[0,1,2,3,4,5,6]))
             OR EXISTS (
               SELECT 1 FROM vehiculo_disponibilidad vd
               WHERE vd.vehiculo_id = v.id AND vd.fecha = dias.fecha::date AND vd.disponible = true
             )
           )
         ))
         AND ($2::text IS NULL OR NOT EXISTS (
           SELECT 1 FROM vehiculo_disponibilidad vd
           WHERE vd.vehiculo_id = v.id AND vd.fecha BETWEEN $2::date AND $3::date AND vd.disponible = false
         ))
         AND ($4::date IS NULL OR (
           EXTRACT(DOW FROM $4::date)::INT = ANY(COALESCE(v.dias_servicio, ARRAY[0,1,2,3,4,5,6]))
           OR EXISTS (
             SELECT 1 FROM vehiculo_disponibilidad vd
             WHERE vd.vehiculo_id = v.id AND vd.fecha = $4::date AND vd.disponible = true
           )
         ))
         AND ($4::date IS NULL OR NOT EXISTS (
           SELECT 1 FROM vehiculo_disponibilidad vd
           WHERE vd.vehiculo_id = v.id AND vd.fecha = $4::date AND vd.disponible = false
         ))
         AND ($2::text IS NULL OR NOT EXISTS (
           SELECT 1 FROM reservas r
           WHERE r.vehiculo_id = v.id
             AND r.estado NOT IN ('cancelada', 'finalizada')
             AND (
               (r.fecha_reserva <= $3::date AND COALESCE(r.fecha_fin, r.fecha_reserva) >= $2::date)
               OR r.fecha_regreso BETWEEN $2::date AND $3::date
               OR ($4::date IS NOT NULL AND (
                 $4::date BETWEEN r.fecha_reserva AND COALESCE(r.fecha_fin, r.fecha_reserva)
                 OR r.fecha_regreso = $4::date
               ))
             )
         ))
       ORDER BY v.capacidad ASC, v.orden ASC NULLS LAST, v.id DESC`,
      [personas, fechaInicio, fechaFin, fechaRegreso]
    );

    const palabrasGrandes = /(equipaj|malet|grupo|ampli|espacio|holgad|voluminos|bulto)/i;
    const palabrasComodas = /(comod|confort|lujo|ejecutivo|premium|privado|aire acondicionado)/i;
    const ranked = result.rows
      .map((vehiculo: any) => {
        let score = 100 - Math.max(0, Number(vehiculo.capacidad) - personas) * 4;
        const textoVehiculo = `${vehiculo.tipo || ""} ${vehiculo.modelo || ""} ${vehiculo.descripcion || ""}`;
        if (tipoPreferido && textoVehiculo.toLowerCase().includes(tipoPreferido)) score += 30;
        if (palabrasGrandes.test(notas) && Number(vehiculo.capacidad) >= personas + 2) score += 18;
        if (palabrasComodas.test(notas) && /(bus|van|sprinter|minibus)/i.test(textoVehiculo.normalize("NFD").replace(/[\u0300-\u036f]/g, ""))) score += 8;
        return { ...vehiculo, score };
      })
      .sort((a: any, b: any) => b.score - a.score)
      .slice(0, 3)
      .map(({ score, dias_servicio, ...vehiculo }: any) => vehiculo);

    const recomendado = ranked[0] || null;
    const message = recomendado
      ? `La categoría ${recomendado.tipo} puede cubrir tu grupo (hasta ${recomendado.capacidad} pasajeros)${fechaInicio ? " según la disponibilidad consultada" : ""}. La unidad específica se confirmará al revisar tu solicitud.`
      : `No encontré un vehículo disponible para ${personas} pasajero${personas === 1 ? "" : "s"}${fechaInicio ? " en esas fechas" : ""}. Prueba con otro rango o reduce el número de pasajeros.`;

    return res.json({ message, recommendation: recomendado, alternatives: ranked.slice(1), criteria: { personas, fechaInicio, fechaFin } });
  } catch (error) {
    console.error("Error recomendando vehículo:", error);
    return res.status(500).json({ error: "No se pudo generar la recomendación" });
  }
};

const verDisponibilidadVehiculoCliente = async (req, res) => {
  const vehiculoId = Number(req.params.id);

  if (!Number.isInteger(vehiculoId) || vehiculoId <= 0) {
    return res.status(400).json({ error: "ID de vehículo inválido" });
  }

  const desde = req.query.desde || new Date().toISOString().slice(0, 10);
  const hasta = req.query.hasta || (() => {
    const date = new Date();
    date.setDate(date.getDate() + 30);
    return date.toISOString().slice(0, 10);
  })();

  try {
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
           AND s.fecha::date BETWEEN fecha_reserva AND COALESCE(fecha_fin, fecha_reserva)
           AND estado NOT IN ('cancelada', 'finalizada')
         LIMIT 1
       ) r ON true
       WHERE v.id = $1
         AND v.activo = true
       ORDER BY s.fecha ASC`,
      [vehiculoId, desde, hasta]
    );

    return res.status(200).json(result.rows);
  } catch (error) {
    console.error("Error consultando disponibilidad de vehículo:", error);
    return res.status(500).json({ error: "Error interno del servidor" });
  }
};

// Endpoint para que el cliente vea SOLO SUS reservas (autenticado por JWT)
const listarMisReservas = async (req: any, res: any) => {
  const userId = req.user?.id;

  if (!userId) {
    return res.status(401).json({ error: "No autenticado" });
  }

  try {
    const result = await pool.query(
      `SELECT
         r.id,
         r.usuario_id,
         r.vehiculo_id,
         r.conductor_id,
         CASE
           WHEN r.estado = 'confirmada' AND r.estado_operativo = 'en_curso' THEN 'en_curso'
           ELSE r.estado
         END AS estado,
         r.estado_operativo,
         r.fecha_reserva,
         r.fecha_fin,
         r.origen,
         r.destino,
         r.num_personas,
         r.total,
         r.notas,
         r.calificacion,
         r.comentario_calificacion,
         r.monto_pagado,
         r.estado_pago,
         r.link_pago,
         r.fecha_regreso,
         r.hora_regreso,
         r.fecha_creacion AS creado_en,
         (
           SELECT json_build_object(
             'id', s.id, 'estado', s.estado,
             'origen_solicitado', s.origen_solicitado,
             'destino_solicitado', s.destino_solicitado,
             'total_anterior', s.total_anterior,
             'total_propuesto', s.total_propuesto,
             'nota_admin', s.nota_admin
           )
           FROM solicitudes_cambio_destino s
           WHERE s.reserva_id = r.id
           ORDER BY s.creado_en DESC, s.id DESC
           LIMIT 1
         ) AS cambio_destino,
         t.titulo AS tour_titulo,
         v.placa AS vehiculo_placa,
         v.modelo AS vehiculo_modelo,
         v.tipo AS vehiculo_tipo,
         v.imagen_url AS vehiculo_imagen_url,
         uc.nombre AS conductor_nombre,
         uc.telefono AS conductor_telefono,
         co.hora_salida
       FROM reservas r
       LEFT JOIN tours t ON t.id = r.tour_id
       LEFT JOIN vehiculos v ON v.id = r.vehiculo_id
       LEFT JOIN usuarios uc ON uc.id = r.conductor_id
       LEFT JOIN cotizaciones co ON co.reserva_id = r.id
       WHERE r.usuario_id = $1
       ORDER BY r.fecha_creacion DESC, r.id DESC`,
      [userId]
    );

    return res.status(200).json(result.rows);
  } catch (error) {
    console.error("Error listando mis reservas:", error);
    return res.status(500).json({ error: "Error interno del servidor" });
  }
};

// Endpoint para que el cliente cancele UNA DE SUS reservas
const cancelarMiReserva = async (req: any, res: any) => {
  const userId = req.user?.id;
  const reservaId = Number(req.params.id);

  if (!userId) {
    return res.status(401).json({ error: "No autenticado" });
  }

  if (!Number.isInteger(reservaId) || reservaId <= 0) {
    return res.status(400).json({ error: "ID de reserva inválido" });
  }

  const motivo = typeof req.body?.motivo === "string" ? req.body.motivo.trim().slice(0, 500) : "";
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const check = await client.query(
      "SELECT id, estado FROM reservas WHERE id = $1 AND usuario_id = $2 FOR UPDATE",
      [reservaId, userId]
    );
    if (!check.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Reserva no encontrada" });
    }

    const reserva = check.rows[0];
    if (["finalizada", "cancelada", "en_curso"].includes(reserva.estado)) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: `No se puede cancelar una reserva en estado '${reserva.estado}'` });
    }

    await client.query(
      "UPDATE reservas SET estado = 'cancelada' WHERE id = $1 AND usuario_id = $2",
      [reservaId, userId]
    );
    const cancelledOperations = await client.query(
      `WITH affected AS (
         SELECT id, estado FROM operaciones
         WHERE reserva_id = $1 AND estado IN ('programada', 'asignada', 'incidencia')
         FOR UPDATE
       )
       UPDATE operaciones o SET estado = 'cancelada', actualizado_en = CURRENT_TIMESTAMP
       FROM affected a WHERE o.id = a.id
       RETURNING o.id, a.estado AS estado_anterior`,
      [reservaId]
    );
    for (const operation of cancelledOperations.rows) {
      await client.query(
        `INSERT INTO operacion_historial (operacion_id, usuario_id, accion, estado_anterior, estado_nuevo, detalle)
         VALUES ($1, $2, 'cancelacion_reserva', $3, 'cancelada', $4::jsonb)`,
        [operation.id, userId, operation.estado_anterior, JSON.stringify({ reserva_id: reservaId, motivo: motivo || "Cancelación solicitada por el cliente" })]
      );
    }
    await recordReservationHistory(
      client,
      reservaId,
      userId,
      "cancelacion_cliente",
      reserva.estado,
      "cancelada",
      { motivo: motivo || "Cancelación solicitada por el cliente", operaciones_canceladas: cancelledOperations.rowCount }
    );
    await client.query("COMMIT");

    return res.status(200).json({ message: "Reserva cancelada correctamente" });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error cancelando reserva:", error);
    return res.status(500).json({ error: "Error interno del servidor" });
  } finally {
    client.release();
  }
};

// El cliente cambia la fecha/hora de salida de su reserva YA CONFIRMADA. Actualiza
// la reserva y la cotización ligada (de donde el conductor lee la hora), y avisa:
// correo al cliente + notificación in-app al admin y al conductor.
const reprogramarMiReserva = async (req: any, res: any) => {
  const userId = req.user?.id;
  const reservaId = Number(req.params.id);
  if (!userId) return res.status(401).json({ error: "No autenticado" });
  if (!Number.isInteger(reservaId) || reservaId <= 0) return res.status(400).json({ error: "ID de reserva inválido" });

  const fecha = typeof req.body?.fecha === "string" ? req.body.fecha.trim() : "";
  const hora = typeof req.body?.hora === "string" ? req.body.hora.trim().slice(0, 10) : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return res.status(400).json({ error: "Indica una fecha válida" });
  if (hora && !/^\d{2}:\d{2}(:\d{2})?$/.test(hora)) return res.status(400).json({ error: "Indica una hora válida" });
  if (fecha < new Date().toISOString().slice(0, 10)) return res.status(400).json({ error: "La fecha no puede ser anterior a hoy" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const check = await client.query(
      `SELECT id, estado, fecha_reserva::text AS fecha_reserva,
              fecha_fin::text AS fecha_fin, fecha_regreso::text AS fecha_regreso,
              fecha_servicio, fecha_salida, fecha_llegada,
              to_char(fecha_salida, 'HH24:MI:SS') AS salida_hora,
              to_char(fecha_llegada, 'HH24:MI:SS') AS llegada_hora,
              hora_salida, hora_regreso,
              num_personas, vehiculo_id, conductor_id
       FROM reservas WHERE id = $1 AND usuario_id = $2 FOR UPDATE`,
      [reservaId, userId]
    );
    if (!check.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Reserva no encontrada" });
    }
    const reserva = check.rows[0];
    if (check.rows[0].estado !== "confirmada") {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Solo puedes cambiar la fecha/hora de una reserva confirmada" });
    }

    const oldStart = dateOnly(reserva.fecha_salida) || dateOnly(reserva.fecha_servicio) || dateOnly(reserva.fecha_reserva);
    if (!oldStart) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "La reserva no tiene una fecha de servicio válida para reprogramar" });
    }
    const oldEnd = dateOnly(reserva.fecha_fin) || dateOnly(reserva.fecha_regreso) || dateOnly(reserva.fecha_llegada) || oldStart;
    const deltaDays = dateDifference(oldStart, fecha);
    const newEnd = shiftDate(oldEnd, deltaDays);
    const operationsResult = await client.query(
      `SELECT * FROM operaciones WHERE reserva_id = $1
       AND estado IN ('programada', 'asignada', 'incidencia') FOR UPDATE`,
      [reservaId]
    );
    const operations = operationsResult.rows;
    if (operations.some((operation: any) => operation.subcontratacion_estado === "confirmada" && !operation.vehiculo_asociado_id)) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "La asignación externa no tiene un vehículo registrado para comprobar disponibilidad. Contacta al administrador." });
    }

    const vehicleIds = [...new Set([
      ...(reserva.vehiculo_id ? [Number(reserva.vehiculo_id)] : []),
      ...operations.filter((operation: any) => operation.vehiculo_id).map((operation: any) => Number(operation.vehiculo_id)),
    ])];
    const reservationDriverIds = reserva.conductor_id ? [Number(reserva.conductor_id)] : [];
    const operationDriverIds = [...new Set(operations
      .filter((operation: any) => operation.conductor_id)
      .map((operation: any) => Number(operation.conductor_id)))];
    const associatedVehicleIds = [...new Set(operations
      .filter((operation: any) => operation.vehiculo_asociado_id)
      .map((operation: any) => Number(operation.vehiculo_asociado_id)))];
    const newStartTime = hora || reserva.hora_salida || reserva.salida_hora || operations.find((operation: any) => operation.hora_inicio)?.hora_inicio || null;
    const oldStartMinutes = String(reserva.salida_hora || reserva.hora_salida || "").slice(0, 5).split(":").map(Number);
    const oldEndMinutes = String(reserva.llegada_hora || "").slice(0, 5).split(":").map(Number);
    const requestedStartMinutes = String(newStartTime || "").slice(0, 5).split(":").map(Number);
    const oldDuration = oldStartMinutes.length === 2 && oldEndMinutes.length === 2
      && oldStartMinutes.every(Number.isFinite) && oldEndMinutes.every(Number.isFinite)
      ? oldEndMinutes[0] * 60 + oldEndMinutes[1] - (oldStartMinutes[0] * 60 + oldStartMinutes[1])
      : null;
    const newEndMinutes = oldDuration !== null && oldDuration > 0 && requestedStartMinutes.length === 2
      && requestedStartMinutes.every(Number.isFinite)
      ? (requestedStartMinutes[0] * 60 + requestedStartMinutes[1] + oldDuration) % 1440
      : null;
    const endTime = newEndMinutes === null
      ? reserva.llegada_hora || null
      : `${String(Math.floor(newEndMinutes / 60)).padStart(2, "0")}:${String(newEndMinutes % 60).padStart(2, "0")}:00`;

    if (vehicleIds.length) {
      await client.query("SELECT id FROM vehiculos WHERE id = ANY($1::int[]) ORDER BY id FOR UPDATE", [vehicleIds]);
      const vehicleBlock = await client.query(
        `SELECT id, placa,
                CASE
                  WHEN activo IS DISTINCT FROM true THEN 'inactivo'
                  WHEN estado <> 'disponible' THEN estado
                  WHEN capacidad < $2 THEN 'capacidad insuficiente'
                  WHEN fecha_proximo_mantenimiento IS NOT NULL AND fecha_proximo_mantenimiento <= $3::date THEN 'mantenimiento vencido'
                  WHEN proximo_km_mantenimiento IS NOT NULL AND proximo_km_mantenimiento <= COALESCE(kilometraje, 0) THEN 'mantenimiento por kilometraje vencido'
                END AS bloqueo
         FROM vehiculos
         WHERE id = ANY($1::int[])
           AND (
             activo IS DISTINCT FROM true OR estado <> 'disponible' OR capacidad < $2
             OR (fecha_proximo_mantenimiento IS NOT NULL AND fecha_proximo_mantenimiento <= $3::date)
             OR (proximo_km_mantenimiento IS NOT NULL AND proximo_km_mantenimiento <= COALESCE(kilometraje, 0))
           )
         LIMIT 1`,
        [vehicleIds, reserva.num_personas, fecha]
      );
      if (vehicleBlock.rowCount) {
        await client.query("ROLLBACK");
        return res.status(409).json({
          error: `El vehículo asignado ${vehicleBlock.rows[0].placa || ""} no puede cubrir el servicio: ${vehicleBlock.rows[0].bloqueo}`,
        });
      }

      const calendarBlock = await client.query(
        `SELECT dia.fecha::date::text AS fecha
         FROM vehiculos v
         CROSS JOIN LATERAL generate_series($2::date, $3::date, INTERVAL '1 day') AS dia(fecha)
         LEFT JOIN vehiculo_disponibilidad vd ON vd.vehiculo_id = v.id AND vd.fecha = dia.fecha
         WHERE v.id = ANY($1::int[])
           AND (vd.disponible = false OR (
             vd.disponible IS DISTINCT FROM true
             AND NOT (EXTRACT(DOW FROM dia.fecha)::int = ANY(COALESCE(v.dias_servicio, ARRAY[0,1,2,3,4,5,6])))
           ))
         ORDER BY dia.fecha LIMIT 1`,
        [vehicleIds, fecha, newEnd]
      );
      if (calendarBlock.rowCount) {
        await client.query("ROLLBACK");
        return res.status(409).json({ error: `El vehículo asignado no está disponible el ${calendarBlock.rows[0].fecha}` });
      }

      const maintenance = await client.query(
        `SELECT id FROM mantenimiento_vehiculos
         WHERE vehiculo_id = ANY($1::int[])
           AND (estado = 'en_progreso' OR (estado = 'programado' AND fecha_programada BETWEEN $2::date AND $3::date))
         LIMIT 1`,
        [vehicleIds, fecha, newEnd]
      );
      if (maintenance.rowCount) {
        await client.query("ROLLBACK");
        return res.status(409).json({ error: "El vehículo asignado tiene mantenimiento en el nuevo período" });
      }
    }
    if (operationDriverIds.length || reservationDriverIds.length) {
      await client.query(
        `SELECT c.id FROM conductores c
         WHERE c.id = ANY($1::int[]) OR c.usuario_id = ANY($2::int[])
         ORDER BY c.id FOR UPDATE`,
        [operationDriverIds, reservationDriverIds]
      );
      const driverBlock = await client.query(
        `SELECT c.id, c.estado, c.fecha_licencia_vencimiento, u.activo
         FROM conductores c JOIN usuarios u ON u.id = c.usuario_id
        WHERE (c.id = ANY($1::int[]) OR c.usuario_id = ANY($2::int[]))
          AND (
           u.activo IS DISTINCT FROM true OR c.estado IN ('inactivo', 'mantenimiento')
           OR (c.fecha_licencia_vencimiento IS NOT NULL AND c.fecha_licencia_vencimiento < $3::date)
         )
         LIMIT 1`,
        [operationDriverIds, reservationDriverIds, fecha]
      );
      if (driverBlock.rowCount) {
        await client.query("ROLLBACK");
        return res.status(409).json({ error: "El conductor asignado no está habilitado para la nueva fecha" });
      }
    }
    if (associatedVehicleIds.length) {
      await client.query(
        "SELECT id FROM vehiculos_asociados WHERE id = ANY($1::int[]) ORDER BY id FOR UPDATE",
        [associatedVehicleIds]
      );
    }

    const hasConflictingOperation = await client.query(
      `SELECT id FROM operaciones
       WHERE reserva_id IS DISTINCT FROM $1 AND estado IN ('programada', 'asignada', 'en_curso', 'incidencia')
         AND fecha_programada <= $3::date
         AND COALESCE(fecha_fin_programada, fecha_programada) >= $2::date
         AND (
           vehiculo_id = ANY($4::int[])
           OR conductor_id = ANY($5::int[])
           OR EXISTS (
             SELECT 1 FROM conductores c
             WHERE c.id = operaciones.conductor_id AND c.usuario_id = ANY($6::int[])
           )
           OR vehiculo_asociado_id = ANY($7::int[])
         )
         AND (
           $2::date <> $3::date OR COALESCE(fecha_fin_programada, fecha_programada) <> fecha_programada
           OR $8::time IS NULL OR hora_inicio IS NULL OR $9::time IS NULL OR hora_fin IS NULL
           OR (hora_inicio < $9::time AND $8::time < hora_fin)
         )
       LIMIT 1`,
      [reservaId, fecha, newEnd, vehicleIds, operationDriverIds, reservationDriverIds, associatedVehicleIds, newStartTime, endTime]
    );
    if (hasConflictingOperation.rowCount) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "El vehículo o conductor asignado ya tiene otro servicio en esa fecha y horario" });
    }

    const hasConflictingReservation = await client.query(
      `SELECT id FROM reservas
       WHERE id <> $1 AND estado NOT IN ('cancelada', 'finalizada')
         AND COALESCE(fecha_salida::date, fecha_servicio::date, fecha_reserva::date) <= $3::date
         AND COALESCE(fecha_fin, fecha_regreso, fecha_llegada::date, fecha_salida::date, fecha_servicio::date, fecha_reserva::date) >= $2::date
         AND (vehiculo_id = ANY($4::int[]) OR conductor_id = ANY($5::int[]))
       LIMIT 1`,
      [reservaId, fecha, newEnd, vehicleIds, reservationDriverIds]
    );
    if (hasConflictingReservation.rowCount) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "El vehículo o conductor asignado ya está reservado en esa fecha" });
    }

    if (vehicleIds.length === 0 && associatedVehicleIds.length === 0) {
      const fleetOption = await client.query(
        `SELECT v.id
         FROM vehiculos v
         WHERE v.activo = true AND v.estado = 'disponible' AND v.capacidad >= $1
           AND NOT EXISTS (
             SELECT 1 FROM generate_series($2::date, $3::date, INTERVAL '1 day') dia
             LEFT JOIN vehiculo_disponibilidad vd ON vd.vehiculo_id = v.id AND vd.fecha = dia
             WHERE vd.disponible = false
               OR (vd.disponible IS DISTINCT FROM true
                   AND NOT (EXTRACT(DOW FROM dia)::int = ANY(COALESCE(v.dias_servicio, ARRAY[0,1,2,3,4,5,6]))))
           )
           AND NOT EXISTS (
             SELECT 1 FROM mantenimiento_vehiculos m
             WHERE m.vehiculo_id = v.id AND (m.estado = 'en_progreso'
               OR (m.estado = 'programado' AND m.fecha_programada BETWEEN $2::date AND $3::date))
           )
           AND NOT EXISTS (
             SELECT 1 FROM reservas r
             WHERE r.id <> $4 AND r.vehiculo_id = v.id AND r.estado NOT IN ('cancelada', 'finalizada')
               AND COALESCE(r.fecha_salida::date, r.fecha_servicio::date, r.fecha_reserva::date) <= $3::date
               AND COALESCE(r.fecha_fin, r.fecha_regreso, r.fecha_llegada::date, r.fecha_salida::date, r.fecha_servicio::date, r.fecha_reserva::date) >= $2::date
           )
           AND NOT EXISTS (
             SELECT 1 FROM operaciones o
             WHERE o.vehiculo_id = v.id AND o.reserva_id IS DISTINCT FROM $4
               AND o.estado IN ('programada', 'asignada', 'en_curso', 'incidencia')
               AND o.fecha_programada <= $3::date AND COALESCE(o.fecha_fin_programada, o.fecha_programada) >= $2::date
           )
         LIMIT 1`,
        [reserva.num_personas, fecha, newEnd, reservaId]
      );
      if (!fleetOption.rowCount) {
        await client.query("ROLLBACK");
        return res.status(409).json({ error: "No hay vehículos propios disponibles para la nueva fecha. Elige otra fecha o contacta al administrador." });
      }
    }

    await client.query(
      `UPDATE reservas
       SET fecha_fin = CASE WHEN fecha_fin IS NOT NULL THEN fecha_fin + ($1::date - $2::date) ELSE NULL END,
           fecha_regreso = CASE WHEN fecha_regreso IS NOT NULL THEN fecha_regreso + ($1::date - $2::date) ELSE NULL END,
           fecha_salida = CASE WHEN fecha_salida IS NOT NULL THEN $1::date + COALESCE(NULLIF($3, '')::time, fecha_salida::time) ELSE NULL END,
           fecha_llegada = CASE WHEN fecha_llegada IS NOT NULL THEN
             fecha_llegada + ($1::date - $2::date)
             + CASE WHEN NULLIF($3, '') IS NOT NULL AND fecha_salida IS NOT NULL
                 THEN ($3::time - fecha_salida::time) ELSE INTERVAL '0' END
             ELSE NULL END,
           fecha_servicio = CASE WHEN fecha_servicio IS NOT NULL THEN $1::date + COALESCE(NULLIF($3, '')::time, fecha_servicio::time) ELSE NULL END,
           fecha_reserva = $1,
           hora_salida = COALESCE(NULLIF($3, ''), hora_salida)
       WHERE id = $4 AND usuario_id = $5`,
      [fecha, oldStart, hora, reservaId, userId]
    );
    await client.query(
      `UPDATE cotizaciones
         SET fecha_fin = CASE WHEN fecha_fin IS NOT NULL THEN fecha_fin + ($1::date - fecha_servicio) ELSE NULL END,
             fecha_regreso = CASE WHEN fecha_regreso IS NOT NULL THEN fecha_regreso + ($1::date - fecha_servicio) ELSE NULL END,
             fecha_servicio = $1,
             hora_salida = COALESCE(NULLIF($2, ''), hora_salida)
       WHERE reserva_id = $3`,
      [fecha, hora, reservaId]
    );
    for (const operation of operations) {
      const endOperationDate = dateOnly(operation.fecha_fin_programada);
      const durationMinutes = operation.hora_inicio && operation.hora_fin
        ? (() => {
          const [startHour, startMinute] = String(operation.hora_inicio).slice(0, 5).split(":").map(Number);
          const [finishHour, finishMinute] = String(operation.hora_fin).slice(0, 5).split(":").map(Number);
          return finishHour * 60 + finishMinute - (startHour * 60 + startMinute);
        })()
        : null;
      const adjustedEndTime = hora && durationMinutes !== null && durationMinutes > 0
        ? `${String(Math.floor(((Number(hora.slice(0, 2)) * 60 + Number(hora.slice(3, 5)) + durationMinutes) % 1440) / 60)).padStart(2, "0")}:${String((Number(hora.slice(0, 2)) * 60 + Number(hora.slice(3, 5)) + durationMinutes) % 60).padStart(2, "0")}`
        : null;
      await client.query(
        `UPDATE operaciones
         SET fecha_programada = fecha_programada + ($1::date - $2::date),
             fecha_fin_programada = CASE WHEN fecha_fin_programada IS NOT NULL THEN fecha_fin_programada + ($1::date - $2::date) ELSE NULL END,
             hora_inicio = COALESCE(NULLIF($3, '')::time, hora_inicio),
             hora_fin = COALESCE(NULLIF($4, '')::time, hora_fin),
             actualizado_en = CURRENT_TIMESTAMP
         WHERE id = $5`,
        [fecha, oldStart, hora, adjustedEndTime || "", operation.id]
      );
      await client.query(
        `INSERT INTO operacion_historial (operacion_id, usuario_id, accion, estado_anterior, estado_nuevo, detalle)
         VALUES ($1, $2, 'reprogramacion_cliente', $3, $3, $4::jsonb)`,
        [
          operation.id,
          userId,
          operation.estado,
          JSON.stringify({
            fecha_anterior: dateOnly(operation.fecha_programada),
            fecha_nueva: shiftDate(dateOnly(operation.fecha_programada) || oldStart, deltaDays),
            fecha_fin_anterior: endOperationDate,
            fecha_fin_nueva: endOperationDate ? shiftDate(endOperationDate, deltaDays) : null,
            hora_inicio_anterior: operation.hora_inicio || null,
            hora_inicio_nueva: hora || operation.hora_inicio || null,
          }),
        ]
      );
    }
    await recordReservationHistory(client, reservaId, userId, "reprogramacion_cliente", "confirmada", "confirmada", {
      fecha_anterior: oldStart,
      fecha_nueva: fecha,
      fecha_fin_anterior: oldEnd,
      fecha_fin_nueva: newEnd,
      hora_anterior: reserva.hora_salida || null,
      hora_nueva: hora || reserva.hora_salida || null,
    });
    await client.query("COMMIT");

    try {
      await notificarReprogramacion(reservaId, userId);
    } catch (notificationError) {
      console.error(`No se pudo notificar la reprogramación de la reserva #${reservaId}:`, notificationError);
    }

    return res.status(200).json({ message: "Fecha/hora actualizada. Se notificó al administrador y al conductor." });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error reprogramando reserva:", error);
    return res.status(500).json({ error: "Error interno del servidor" });
  } finally {
    client.release();
  }
};

// El cliente califica una reserva finalizada (1-5) y se recalcula el rating del conductor
const calificarMiReserva = async (req: any, res: any) => {
  const userId = req.user?.id;
  const reservaId = Number(req.params.id);
  const calificacion = Number(req.body.calificacion);
  const comentario = typeof req.body.comentario === "string" ? req.body.comentario.trim().slice(0, 500) : null;

  if (!userId) return res.status(401).json({ error: "No autenticado" });
  if (!Number.isInteger(reservaId) || reservaId <= 0) return res.status(400).json({ error: "ID de reserva inválido" });
  if (!Number.isInteger(calificacion) || calificacion < 1 || calificacion > 5) {
    return res.status(400).json({ error: "La calificación debe ser un número del 1 al 5" });
  }

  try {
    const check = await pool.query(
      `SELECT id, estado, conductor_id, total, estado_pago
       FROM reservas WHERE id = $1 AND usuario_id = $2 LIMIT 1`,
      [reservaId, userId]
    );
    if (check.rowCount === 0) return res.status(404).json({ error: "Reserva no encontrada" });

    const reserva = check.rows[0];
    if (reserva.estado !== "finalizada") {
      return res.status(400).json({ error: "Solo puedes calificar viajes finalizados" });
    }
    if (Number(reserva.total) > 0 && reserva.estado_pago !== "pagado") {
      return res.status(400).json({ error: "Este viaje no cuenta como realizado porque el pago total no está confirmado" });
    }

    await pool.query(
      "UPDATE reservas SET calificacion = $1, comentario_calificacion = $2, calificado_en = NOW() WHERE id = $3",
      [calificacion, comentario, reservaId]
    );

    // Recalcular el rating promedio del conductor (reservas.conductor_id -> conductores.id)
    if (reserva.conductor_id) {
      const avg = await pool.query(
        "SELECT AVG(calificacion)::numeric(3,2) AS prom FROM reservas WHERE conductor_id = $1 AND calificacion IS NOT NULL",
        [reserva.conductor_id]
      );
      const prom = avg.rows[0]?.prom;
      if (prom !== null && prom !== undefined) {
        await pool.query("UPDATE conductores SET rating_promedio = $1 WHERE id = $2", [prom, reserva.conductor_id]);
      }
    }

    return res.status(200).json({ message: "¡Gracias por calificar tu viaje!" });
  } catch (error) {
    console.error("Error calificando reserva:", error);
    return res.status(500).json({ error: "Error interno del servidor" });
  }
};

// El cliente sigue en tiempo real la ubicación del vehículo de su reserva
const seguimientoMiReserva = async (req: any, res: any) => {
  const userId = req.user?.id;
  const reservaId = Number(req.params.id);
  if (!userId) return res.status(401).json({ error: "No autenticado" });
  if (!Number.isInteger(reservaId) || reservaId <= 0) return res.status(400).json({ error: "ID de reserva inválido" });

  try {
    const r = await pool.query(
      `SELECT r.id, r.estado, r.vehiculo_id,
              v.placa, v.modelo,
              uc.nombre AS conductor_nombre, uc.telefono AS conductor_telefono,
              co.origen_lat, co.origen_lng, co.destino_lat, co.destino_lng
       FROM reservas r
       LEFT JOIN vehiculos v ON v.id = r.vehiculo_id
       LEFT JOIN conductores c ON c.id = r.conductor_id
       LEFT JOIN usuarios uc ON uc.id = c.usuario_id
       LEFT JOIN cotizaciones co ON co.reserva_id = r.id
       WHERE r.id = $1 AND r.usuario_id = $2
       LIMIT 1`,
      [reservaId, userId]
    );
    if (r.rowCount === 0) return res.status(404).json({ error: "Reserva no encontrada" });
    const reserva = r.rows[0];

    let vehiculo = null;
    if (reserva.vehiculo_id) {
      const loc = await pool.query(
        `SELECT lat, lng, creado_en FROM vehiculo_ubicacion
         WHERE vehiculo_id = $1 ORDER BY creado_en DESC LIMIT 1`,
        [reserva.vehiculo_id]
      );
      if (loc.rowCount) vehiculo = loc.rows[0];
    }

    return res.status(200).json({
      estado: reserva.estado,
      placa: reserva.placa,
      modelo: reserva.modelo,
      conductor_nombre: reserva.conductor_nombre,
      conductor_telefono: reserva.conductor_telefono,
      vehiculo, // {lat,lng,creado_en} o null si aún no comparte
      origen: reserva.origen_lat != null ? { lat: Number(reserva.origen_lat), lng: Number(reserva.origen_lng) } : null,
      destino: reserva.destino_lat != null ? { lat: Number(reserva.destino_lat), lng: Number(reserva.destino_lng) } : null,
    });
  } catch (error) {
    console.error("Error en seguimiento de reserva:", error);
    return res.status(500).json({ error: "Error interno del servidor" });
  }
};

// El cliente elimina (o desactiva si tiene reservas) su propia cuenta
const eliminarMiCuenta = async (req: any, res: any) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: "No autenticado" });

  try {
    const result = await pool.query("DELETE FROM usuarios WHERE id = $1 RETURNING id", [userId]);
    if (result.rowCount === 0) return res.status(404).json({ error: "Usuario no encontrado" });
    return res.status(200).json({ message: "Cuenta eliminada correctamente" });
  } catch (error: any) {
    if (error.code === "23503") {
      // Tiene reservas relacionadas: se desactiva en lugar de borrar
      await pool.query("UPDATE usuarios SET activo = false WHERE id = $1", [userId]);
      return res.status(200).json({ message: "Cuenta desactivada (tenía reservas asociadas)" });
    }
    console.error("Error eliminando cuenta:", error);
    return res.status(500).json({ error: "Error interno del servidor" });
  }
};

module.exports = {
  crearUsuario,
  listarUsuarios,
  listarVehiculosCliente,
  listarTarifasCliente,
  recomendarVehiculo,
  verDisponibilidadVehiculoCliente,
  listarMisReservas,
  cancelarMiReserva,
  reprogramarMiReserva,
  calificarMiReserva,
  seguimientoMiReserva,
  eliminarMiCuenta,
};
