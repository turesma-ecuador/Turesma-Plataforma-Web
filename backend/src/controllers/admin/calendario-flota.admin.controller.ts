export {};

const pool = require("../../config/db");

const isValidDate = (value: unknown): value is string => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

const getCalendarioFlota = async (req: any, res: any) => {
  const { desde, hasta } = req.query;
  if (!isValidDate(desde) || !isValidDate(hasta) || desde > hasta) {
    return res.status(400).json({ error: "Indica un rango de fechas válido" });
  }

  const rangeLength = (Date.parse(`${hasta}T00:00:00.000Z`) - Date.parse(`${desde}T00:00:00.000Z`)) / 86_400_000;
  if (rangeLength > 62) {
    return res.status(400).json({ error: "El calendario permite consultar hasta 63 días por solicitud" });
  }

  try {
    const [vehicles, operations, reservations, maintenance, maintenanceBlocks, externalAvailability, unassignedReservations] = await Promise.all([
      pool.query(
        `SELECT id, placa, tipo, modelo, estado
         FROM vehiculos
         WHERE activo = true
         ORDER BY tipo ASC NULLS LAST, placa ASC`
      ),
      pool.query(
        `SELECT o.id, o.vehiculo_id,
                GREATEST(o.fecha_programada, $1::date)::text AS fecha_inicio,
                LEAST(COALESCE(o.fecha_fin_programada, o.fecha_programada), $2::date)::text AS fecha_fin,
                o.estado,
                CASE WHEN o.requerimiento_id IS NOT NULL
                  THEN 'Requerimiento #' || o.requerimiento_id || ' - Grupo ' || o.grupo_numero || ' - Unidad ' || o.unidad_numero
                       || COALESCE(' - ' || o.tipo_vehiculo_solicitado, '')
                  ELSE o.tipo_servicio
                END AS tipo_servicio,
                o.hora_inicio::text AS hora_inicio, o.hora_fin::text AS hora_fin,
                o.origen, o.destino, o.reserva_id,
                concat_ws(' ', conductor.nombre, conductor.apellido) AS conductor_nombre
         FROM operaciones o
         LEFT JOIN conductores c ON c.id = o.conductor_id
         LEFT JOIN usuarios conductor ON conductor.id = c.usuario_id
         WHERE o.fecha_programada <= $2::date
           AND COALESCE(o.fecha_fin_programada, o.fecha_programada) >= $1::date
           AND o.estado <> 'cancelada'
           AND o.vehiculo_id IS NOT NULL
         ORDER BY o.fecha_programada, o.hora_inicio NULLS LAST`,
        [desde, hasta]
      ),
      pool.query(
        `SELECT r.id::text AS id, r.vehiculo_id,
                GREATEST(COALESCE(r.fecha_salida::date, r.fecha_servicio::date, r.fecha_reserva), $1::date)::text AS fecha_inicio,
                LEAST(COALESCE(r.fecha_llegada::date, r.fecha_fin, r.fecha_reserva), $2::date)::text AS fecha_fin,
                r.estado, r.tipo_vehiculo AS tipo_servicio,
                r.fecha_salida::time::text AS hora_inicio,
                r.fecha_llegada::time::text AS hora_fin,
                r.origen, r.destino, r.id AS reserva_id,
                concat_ws(' ', conductor.nombre, conductor.apellido) AS conductor_nombre
         FROM reservas r
         LEFT JOIN usuarios conductor ON conductor.id = r.conductor_id
         WHERE r.vehiculo_id IS NOT NULL
           AND r.estado NOT IN ('cancelada', 'finalizada')
           AND COALESCE(r.fecha_salida::date, r.fecha_servicio::date, r.fecha_reserva) <= $2::date
           AND COALESCE(r.fecha_llegada::date, r.fecha_fin, r.fecha_reserva) >= $1::date
           AND NOT EXISTS (
             SELECT 1 FROM operaciones o
             WHERE o.reserva_id = r.id AND o.estado <> 'cancelada'
           )
         UNION ALL
         SELECT r.id::text || '-regreso' AS id, r.vehiculo_id,
                r.fecha_regreso::text AS fecha_inicio,
                r.fecha_regreso::text AS fecha_fin,
                r.estado, 'Regreso de reserva' AS tipo_servicio,
                r.hora_regreso::time::text AS hora_inicio,
                r.hora_regreso::time::text AS hora_fin,
                r.destino AS origen, r.origen AS destino, r.id AS reserva_id,
                concat_ws(' ', conductor.nombre, conductor.apellido) AS conductor_nombre
         FROM reservas r
         LEFT JOIN usuarios conductor ON conductor.id = r.conductor_id
         WHERE r.fecha_regreso BETWEEN $1::date AND $2::date
           AND r.vehiculo_id IS NOT NULL
           AND r.estado NOT IN ('cancelada', 'finalizada')
           AND NOT EXISTS (
             SELECT 1 FROM operaciones o
             WHERE o.reserva_id = r.id AND o.fecha_programada = r.fecha_regreso AND o.estado <> 'cancelada'
           )
         ORDER BY fecha_inicio, id`,
        [desde, hasta]
      ),
      pool.query(
        `SELECT m.id, m.vehiculo_id, m.fecha_programada::text AS fecha_inicio,
                m.fecha_programada::text AS fecha_fin, m.tipo AS tipo_servicio,
                m.estado, m.descripcion
         FROM mantenimiento_vehiculos m
         WHERE m.fecha_programada BETWEEN $1::date AND $2::date
           AND m.estado IN ('programado', 'en_progreso')
         ORDER BY m.fecha_programada, m.id`,
        [desde, hasta]
      ),
      pool.query(
        `SELECT 'indisponibilidad-' || b.id AS id, b.vehiculo_id,
                GREATEST(b.fecha_inicio, $1::date)::text AS fecha_inicio,
                LEAST(COALESCE(b.fecha_fin, $2::date), $2::date)::text AS fecha_fin,
                CASE WHEN b.urgente THEN 'en_progreso' ELSE 'programado' END AS estado,
                CASE WHEN b.urgente THEN 'Urgente · ' ELSE '' END || 'Mantenimiento ' || b.tipo AS tipo_servicio,
                b.hora_inicio::text AS hora_inicio, b.hora_fin::text AS hora_fin,
                NULL::text AS origen, NULL::text AS destino,
                b.motivo AS descripcion, u.nombre AS conductor_nombre,
                NULL::text AS cliente_empresa, b.motivo AS notas
         FROM vehiculo_indisponibilidades b
         JOIN usuarios u ON u.id = b.creado_por
         WHERE b.estado = 'activa'
           AND b.fecha_inicio <= $2::date
           AND COALESCE(b.fecha_fin, 'infinity'::date) >= $1::date
         ORDER BY b.fecha_inicio, b.id`,
        [desde, hasta]
      ),
      pool.query(
        `SELECT d.id, d.vehiculo_id, d.fecha_inicio::text, d.fecha_fin::text,
                d.estado, d.motivo AS tipo_servicio, d.hora_inicio::text,
                d.hora_fin::text, d.cliente_empresa, d.origen, d.destino, d.notas,
                u.nombre AS conductor_nombre
         FROM disponibilidad_externa d
         JOIN usuarios u ON u.id = d.conductor_usuario_id
         WHERE d.estado = 'activo'
           AND d.fecha_inicio <= $2::date
           AND d.fecha_fin >= $1::date
         ORDER BY d.fecha_inicio, d.hora_inicio NULLS LAST, d.id`,
        [desde, hasta]
      ),
      pool.query(
        `SELECT r.id, r.fecha_salida, r.fecha_servicio, r.fecha_reserva, r.fecha_llegada,
                r.fecha_fin, r.fecha_regreso::text AS fecha_regreso, r.hora_regreso, r.origen, r.destino, r.tipo_vehiculo, r.num_personas,
                COALESCE(u.nombre, 'Cliente') AS cliente_nombre,
                o.id AS operacion_id, o.subcontratacion_estado
         FROM reservas r
         LEFT JOIN usuarios u ON u.id = r.usuario_id
         LEFT JOIN LATERAL (
           SELECT op.id, op.subcontratacion_estado, op.vehiculo_id
           FROM operaciones op
           WHERE op.reserva_id = r.id AND op.estado <> 'cancelada'
           ORDER BY op.id DESC
           LIMIT 1
         ) o ON true
         WHERE r.estado = 'confirmada'
           AND NOT EXISTS (
             SELECT 1 FROM requerimientos_personalizados rp WHERE rp.reserva_id = r.id
           )
           AND (
             (
               COALESCE(r.fecha_salida::date, r.fecha_servicio::date, r.fecha_reserva) <= $2::date
               AND COALESCE(r.fecha_llegada::date, r.fecha_fin, r.fecha_reserva) >= $1::date
             )
             OR r.fecha_regreso BETWEEN $1::date AND $2::date
           )
           AND r.vehiculo_id IS NULL
           AND (o.id IS NULL OR (o.vehiculo_id IS NULL AND o.subcontratacion_estado <> 'confirmada'))
         ORDER BY COALESCE(r.fecha_salida::date, r.fecha_servicio::date, r.fecha_reserva), r.id
         LIMIT 200`,
        [desde, hasta]
      ),
    ]);

    return res.json({
      vehicles: vehicles.rows,
      events: [
        ...operations.rows.map((event: Record<string, unknown>) => ({ ...event, tipo: "operacion" })),
        ...reservations.rows.map((event: Record<string, unknown>) => ({ ...event, tipo: "reserva" })),
        ...maintenance.rows.map((event: Record<string, unknown>) => ({ ...event, tipo: "mantenimiento" })),
        ...maintenanceBlocks.rows.map((event: Record<string, unknown>) => ({ ...event, tipo: "mantenimiento" })),
        ...externalAvailability.rows.map((event: Record<string, unknown>) => ({ ...event, tipo: "externo" })),
      ],
      unassignedReservations: unassignedReservations.rows,
    });
  } catch (error) {
    console.error("Error cargando calendario de flota:", error);
    return res.status(500).json({ error: "No se pudo cargar el calendario de flota" });
  }
};

module.exports = { getCalendarioFlota };
