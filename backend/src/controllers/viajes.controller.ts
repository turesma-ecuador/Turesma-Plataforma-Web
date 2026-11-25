export {};

const pool = require("../config/db");
const { notificarAdmins, crearNotificacion, usuarioIdDeConductor } = require("../config/notificaciones");

const positiveInt = (value: unknown) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const listarViajesPublicos = async (_req: any, res: any) => {
  try {
    const result = await pool.query(`
      SELECT t.id, t.titulo, t.descripcion, t.precio, t.duracion, COALESCE(v.capacidad, t.capacidad, 0)::int AS capacidad_personas, COALESCE((SELECT jsonb_agg(ti.imagen_url ORDER BY ti.orden) FROM tour_imagenes ti WHERE ti.tour_id = t.id), t.imagenes) AS imagenes,
             t.origen, t.destino, t.fecha_servicio, t.hora_salida, t.cupos_totales,
             t.tipo_servicio, t.imagen_url, v.placa AS vehiculo_placa, v.modelo AS vehiculo_modelo, v.imagen_url AS vehiculo_imagen_url,
             GREATEST(COALESCE(v.capacidad, t.cupos_totales, t.capacidad, 0) - COALESCE((SELECT SUM(r.num_personas) FROM reservas r WHERE r.tour_id = t.id AND (t.fecha_servicio IS NULL OR r.fecha_reserva = t.fecha_servicio) AND r.estado NOT IN ('cancelada', 'finalizada')), 0), 0)::int AS cupos_disponibles
      FROM tours t
      LEFT JOIN vehiculos v ON v.id = t.vehiculo_id
      WHERE t.activo = true
        AND t.origen IS NOT NULL
        AND t.destino IS NOT NULL
        AND (t.fecha_servicio IS NULL OR t.fecha_servicio >= CURRENT_DATE)
      ORDER BY t.fecha_servicio ASC NULLS LAST, t.id DESC
    `);
    return res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error("Error listando viajes públicos:", error);
    return res.status(500).json({ success: false, error: "No se pudieron cargar los viajes disponibles" });
  }
};

const reservarViajePublicado = async (req: any, res: any) => {
  const userId = positiveInt(req.user?.id);
  const tourId = positiveInt(req.params.id);
  const passengers = positiveInt(req.body?.num_personas);
  if (!userId || !tourId || !passengers) return res.status(400).json({ success: false, error: "Viaje y número de pasajeros son obligatorios" });
  const travelDate = typeof req.body?.fecha_viaje === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.body.fecha_viaje) ? req.body.fecha_viaje : null;
  const travelTime = typeof req.body?.hora_viaje === "string" && /^\d{2}:\d{2}$/.test(req.body.hora_viaje) ? req.body.hora_viaje : null;
  const pickupLocation = typeof req.body?.ubicacion_recogida === "string" ? req.body.ubicacion_recogida.trim().slice(0, 300) : "";
  const pickupReference = typeof req.body?.referencia_recogida === "string" ? req.body.referencia_recogida.trim().slice(0, 500) : null;
  const pickupLat = Number(req.body?.recogida_lat);
  const pickupLng = Number(req.body?.recogida_lng);
  const hasPickupCoordinates = Number.isFinite(pickupLat) && Number.isFinite(pickupLng)
    && pickupLat >= -90 && pickupLat <= 90 && pickupLng >= -180 && pickupLng <= 180;
  if (!travelDate || !travelTime || !pickupLocation) return res.status(400).json({ success: false, error: "Fecha, hora y ubicación de recogida son obligatorias" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const tourResult = await client.query(`SELECT * FROM tours WHERE id = $1 AND activo = true FOR UPDATE`, [tourId]);
    if (!tourResult.rowCount) return res.status(404).json({ success: false, error: "Viaje no encontrado o no publicado" });
    const tour = tourResult.rows[0];
    const occupied = await client.query(`SELECT COALESCE(SUM(num_personas), 0)::int AS total FROM reservas WHERE tour_id = $1 AND fecha_reserva = $2 AND estado NOT IN ('cancelada', 'finalizada')`, [tourId, travelDate]);
    const vehicleResult = await client.query("SELECT capacidad FROM vehiculos WHERE id = $1 LIMIT 1", [tour.vehiculo_id || null]);
    const capacity = Number(vehicleResult.rows[0]?.capacidad || tour.cupos_totales || tour.capacidad || 0);
    if (Number(occupied.rows[0].total) + passengers > capacity) return res.status(409).json({ success: false, error: "No hay personas disponibles en el vehículo para este viaje" });

    const verified = await client.query("SELECT estado_verificacion FROM usuarios WHERE id = $1", [userId]);
    if (verified.rows[0]?.estado_verificacion !== "verificado") {
      return res.status(403).json({ success: false, error: "Debes verificar tu identidad antes de reservar", requiere_verificacion: true });
    }

    const total = Number(tour.precio) * passengers;
    const reservation = await client.query(`
      INSERT INTO reservas (usuario_id, tour_id, fecha_reserva, fecha_fin, num_personas, total, estado, estado_pago, monto_pagado, origen, destino, vehiculo_id, hora_salida, fecha_salida, fecha_servicio, recogida_lat, recogida_lng, referencia_recogida)
      VALUES ($1, $2, $3, NULL, $4, $5, 'pendiente_pago', 'pendiente', 0, $6, $7, $8, $9, ($3::date + $10::time), ($3::date + $10::time), $11, $12, $13)
      RETURNING id, total, estado, estado_pago
    `, [userId, tourId, travelDate, passengers, total, pickupLocation, tour.destino, tour.vehiculo_id || null, travelTime, travelTime, hasPickupCoordinates ? pickupLat : null, hasPickupCoordinates ? pickupLng : null, pickupReference]);
    await client.query("COMMIT");
    const reservationId = Number(reservation.rows[0].id);
    await notificarAdmins(userId, `Nueva compra del viaje ${tour.origen} - ${tour.destino}. Reserva #${reservationId}.`, "reserva", reservationId);
    const vehicleOwner = await client.query("SELECT usuario_id FROM vehiculos WHERE id = $1 LIMIT 1", [tour.vehiculo_id || null]);
    let driverUserId = Number(vehicleOwner.rows[0]?.usuario_id) || null;
    if (!driverUserId) {
      const assignment = await client.query("SELECT conductor_id FROM asignacion_vehiculos WHERE vehiculo_id = $1 AND estado = 'activa' LIMIT 1", [tour.vehiculo_id || null]);
      driverUserId = await usuarioIdDeConductor(Number(assignment.rows[0]?.conductor_id) || null);
    }
    const notification = `Reserva #${reservationId}: ${pickupLocation} → ${tour.destino}, ${travelDate} a las ${travelTime}.${pickupReference ? ` Referencia: ${pickupReference}` : ""}`;
    if (driverUserId) await crearNotificacion(userId, driverUserId, `Nuevo viaje asignado. ${notification}`, reservationId, "reserva", reservationId);
    const admin = await client.query("SELECT id FROM usuarios WHERE rol = 'admin' AND activo = true AND id <> $1 ORDER BY id LIMIT 1", [userId]);
    const notificationEn = `Reservation #${reservationId}: ${pickupLocation} → ${tour.destino}, ${travelDate} at ${travelTime}.${pickupReference ? ` Reference: ${pickupReference}` : ""}`;
    await crearNotificacion(Number(admin.rows[0]?.id) || driverUserId || null, userId, `Tu reserva fue registrada. ${notification}`, reservationId, "reserva", reservationId, `Your reservation has been registered. ${notificationEn}`);
    return res.status(201).json({ success: true, data: reservation.rows[0], message: "Viaje reservado. Selecciona un método de pago en tu historial." });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error reservando viaje publicado:", error);
    return res.status(500).json({ success: false, error: "No se pudo reservar el viaje" });
  } finally {
    client.release();
  }
};

module.exports = { listarViajesPublicos, reservarViajePublicado };
