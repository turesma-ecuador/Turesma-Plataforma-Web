export {};

const pool = require("./db");

const prepararDespachoRequerimiento = async (reservaId: number, usuarioId?: number | null) => {
  const client = await pool.connect();
  let requerimientoId: number | null = null;
  try {
    await client.query("BEGIN");
    const requestResult = await client.query(
      `SELECT r.id, r.service_groups, r.estado_despacho, b.estado AS estado_reserva, b.estado_pago
       FROM requerimientos_personalizados r
       JOIN reservas b ON b.id = r.reserva_id
       WHERE r.reserva_id = $1
       FOR UPDATE OF r, b`,
      [reservaId]
    );
    if (!requestResult.rowCount) {
      await client.query("COMMIT");
      return { found: false, created: 0 };
    }

    const request = requestResult.rows[0];
    requerimientoId = Number(request.id);
    if (request.estado_reserva !== "confirmada" || request.estado_pago !== "pagado") {
      throw new Error("El requerimiento todavía no tiene el pago total confirmado");
    }

    const existing = await client.query(
      "SELECT COUNT(*)::int AS total FROM operaciones WHERE requerimiento_id = $1",
      [requerimientoId]
    );
    if (request.estado_despacho === "generado") {
      await client.query("COMMIT");
      return { found: true, created: 0, total: Number(existing.rows[0].total) };
    }

    const groups = Array.isArray(request.service_groups) ? request.service_groups : [];
    const includedGroups = groups
      .map((group: Record<string, unknown>, index: number) => ({ group, index }))
      .filter(({ group }) => group.incluido_en_propuesta !== false);
    if (!includedGroups.length) throw new Error("La propuesta no contiene grupos incluidos para despacho");

    let created = 0;
    for (const { group, index: groupIndex } of includedGroups) {
      const count = Number(group.cantidad_vehiculos);
      const passengers = Number(group.pasajeros_por_vehiculo);
      const startDate = typeof group.fecha_servicio === "string" ? group.fecha_servicio : "";
      const endDate = typeof group.fecha_fin === "string" && group.fecha_fin ? group.fecha_fin : startDate;
      const origin = typeof group.origen === "string" ? group.origen.trim() : "";
      const destination = typeof group.destino === "string" ? group.destino.trim() : "";
      const departure = typeof group.hora_salida === "string" && group.hora_salida
        ? `${group.hora_salida}:00`
        : null;

      if (!Number.isInteger(count) || count < 1 || count > 1000
        || !Number.isInteger(passengers) || passengers < 1 || passengers > 1000
        || !/^\d{4}-\d{2}-\d{2}$/.test(startDate)
        || !/^\d{4}-\d{2}-\d{2}$/.test(endDate) || endDate < startDate
        || !origin || !destination) {
        throw new Error(`El grupo ${groupIndex + 1} no tiene fecha, ruta, cantidad o pasajeros válidos`);
      }

      for (let unitIndex = 1; unitIndex <= count; unitIndex += 1) {
        const inserted = await client.query(
          `INSERT INTO operaciones
             (reserva_id, requerimiento_id, grupo_numero, unidad_numero, tipo_servicio, tipo_vehiculo_solicitado,
              fecha_programada, fecha_fin_programada, hora_inicio, origen, destino, pasajeros,
              observaciones, creado_por)
           VALUES ($1, $2, $3, $4, 'requerimiento_especial', $5, $6::date, $7::date, $8::time,
                   $9, $10, $11, $12, $13)
           ON CONFLICT (requerimiento_id, grupo_numero, unidad_numero)
             WHERE requerimiento_id IS NOT NULL DO NOTHING
           RETURNING id`,
          [
            reservaId,
            requerimientoId,
            groupIndex + 1,
            unitIndex,
            typeof group.tipo_vehiculo === "string" ? group.tipo_vehiculo.slice(0, 100) : null,
            startDate,
            endDate,
            departure,
            origin,
            destination,
            passengers,
            [
              `Requerimiento especial #${requerimientoId} · Grupo ${groupIndex + 1} · Unidad ${unitIndex}/${count}`,
              group.tipo_vehiculo ? `Tipo solicitado: ${group.tipo_vehiculo}` : "",
              group.paradas ? `Paradas: ${group.paradas}` : "",
              group.detalles || "",
            ].filter(Boolean).join("\n"),
            usuarioId || null,
          ]
        );
        if (inserted.rowCount) {
          created += 1;
          await client.query(
            `INSERT INTO operacion_historial
               (operacion_id, usuario_id, accion, estado_nuevo, detalle)
             VALUES ($1, $2, 'creacion_requerimiento', 'programada', $3::jsonb)`,
            [
              inserted.rows[0].id,
              usuarioId || null,
              JSON.stringify({ requerimiento_id: requerimientoId, grupo_numero: groupIndex + 1, unidad_numero: unitIndex }),
            ]
          );
        }
      }
    }

    const total = await client.query(
      "SELECT COUNT(*)::int AS total FROM operaciones WHERE requerimiento_id = $1",
      [requerimientoId]
    );
    const expected = includedGroups.reduce((sum: number, { group }) => sum + Number(group.cantidad_vehiculos || 0), 0);
    if (Number(total.rows[0].total) !== expected) {
      throw new Error("El número de operaciones generadas no coincide con los vehículos solicitados");
    }

    await client.query(
      `UPDATE requerimientos_personalizados
       SET estado = 'pagado', estado_despacho = 'generado', error_despacho = NULL, actualizado_en = NOW()
       WHERE id = $1`,
      [requerimientoId]
    );
    await client.query("COMMIT");
    return { found: true, created, total: expected };
  } catch (error) {
    await client.query("ROLLBACK");
    if (requerimientoId !== null) {
      await pool.query(
        `UPDATE requerimientos_personalizados
         SET estado = CASE WHEN EXISTS (
               SELECT 1 FROM reservas b
               WHERE b.id = requerimientos_personalizados.reserva_id
                 AND b.estado = 'confirmada' AND b.estado_pago = 'pagado'
             ) THEN 'pagado' ELSE estado END,
             estado_despacho = 'error', error_despacho = $1, actualizado_en = NOW()
         WHERE id = $2`,
        [error instanceof Error ? error.message : String(error), requerimientoId]
      );
    }
    throw error;
  } finally {
    client.release();
  }
};

module.exports = { prepararDespachoRequerimiento };
