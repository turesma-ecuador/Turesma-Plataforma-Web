const pool = require("../config/db");
const { crearNotificacion, notificarAdmins } = require("../config/notificaciones");

const esOperacionIniciada = async (client: any, reservaId: number) => {
  const result = await client.query(
    `SELECT id FROM operaciones
     WHERE reserva_id = $1 AND estado IN ('en_curso', 'completada')
     LIMIT 1`,
    [reservaId]
  );
  return result.rowCount > 0;
};

const hayOperacionesPreparadas = async (client: any, reservaId: number) => {
  const result = await client.query(
    `SELECT id FROM operaciones
     WHERE reserva_id = $1 AND estado NOT IN ('cancelada', 'completada')
     LIMIT 1`,
    [reservaId]
  );
  return result.rowCount > 0;
};

const registrarHistorial = async (
  client: any,
  reservaId: number,
  userId: number | null,
  accion: string,
  detalle: Record<string, unknown>
) => {
  await client.query(
    `INSERT INTO reserva_historial (reserva_id, usuario_id, accion, estado_anterior, estado_nuevo, detalle)
     VALUES ($1, $2, $3, 'confirmada', 'confirmada', $4::jsonb)`,
    [reservaId, userId, accion, JSON.stringify(detalle)]
  );
};

const aplicarRutaSolicitada = async (client: any, request: any) => {
  await client.query(
    `UPDATE reservas
     SET origen = $1, destino = $2, total = $3, monto_pagado = $4, estado_pago = 'pagado',
         estado = 'confirmada', estado_operativo = NULL
     WHERE id = $5`,
    [
      request.origen_solicitado,
      request.destino_solicitado,
      request.total_propuesto,
      request.total_propuesto,
      request.reserva_id,
    ]
  );
  await client.query(
    `UPDATE cotizaciones
     SET origen = $1, destino = $2,
         origen_lat = NULL, origen_lng = NULL, destino_lat = NULL, destino_lng = NULL
     WHERE reserva_id = $3`,
    [request.origen_solicitado, request.destino_solicitado, request.reserva_id]
  );
};

const crearSolicitudCambioDestino = async (req: any, res: any) => {
  const reservaId = Number(req.params.id);
  const userId = Number(req.user?.id);
  const origen = typeof req.body?.origen === "string" ? req.body.origen.trim() : "";
  const destino = typeof req.body?.destino === "string" ? req.body.destino.trim() : "";
  if (!Number.isInteger(reservaId) || reservaId <= 0 || !Number.isInteger(userId) || userId <= 0) {
    return res.status(400).json({ error: "Reserva o usuario inválido" });
  }
  if (!origen || origen.length > 500 || !destino || destino.length > 500 || origen === destino) {
    return res.status(400).json({ error: "Indica un origen y destino distintos, de hasta 500 caracteres" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const reservationResult = await client.query(
      `SELECT id, usuario_id, estado, estado_pago, estado_operativo, total, monto_pagado, origen, destino, recogido
       FROM reservas WHERE id = $1 AND usuario_id = $2 FOR UPDATE`,
      [reservaId, userId]
    );
    if (!reservationResult.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Reserva no encontrada" });
    }
    const reservation = reservationResult.rows[0];
    if (reservation.estado !== "confirmada" || reservation.estado_pago !== "pagado") {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Solo puedes solicitar cambios de destino en una reserva confirmada y pagada" });
    }
    if (Math.abs(Number(reservation.total) - Number(reservation.monto_pagado)) > 0.01) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "El monto pagado no coincide con el total registrado. Contacta a Turesma para conciliar el pago." });
    }
    if (reservation.estado_operativo === "en_curso" || reservation.recogido || await esOperacionIniciada(client, reservaId)) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "El viaje ya comenzó. No se puede modificar su ruta; contacta a Turesma para gestionar la incidencia" });
    }
    const specialRequest = await client.query(
      "SELECT id FROM requerimientos_personalizados WHERE reserva_id = $1 LIMIT 1",
      [reservaId]
    );
    if (specialRequest.rowCount) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Esta reserva tiene varios servicios asociados. Contacta a Turesma para coordinar el cambio" });
    }
    const existing = await client.query(
      `SELECT id FROM solicitudes_cambio_destino
       WHERE reserva_id = $1
         AND estado IN ('pendiente_admin', 'propuesta_cliente', 'pago_pendiente', 'devolucion_pendiente')
       LIMIT 1`,
      [reservaId]
    );
    if (existing.rowCount) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Ya tienes una solicitud de cambio de destino pendiente" });
    }
    if (origen === String(reservation.origen || "").trim() && destino === String(reservation.destino || "").trim()) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "La nueva ruta debe ser diferente a la actual" });
    }
    const inserted = await client.query(
      `INSERT INTO solicitudes_cambio_destino
         (reserva_id, usuario_id, origen_anterior, destino_anterior, origen_solicitado, destino_solicitado, total_anterior)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, reserva_id, estado, origen_anterior, destino_anterior, origen_solicitado, destino_solicitado, total_anterior, creado_en`,
      [reservaId, userId, reservation.origen, reservation.destino, origen, destino, reservation.total]
    );
    await registrarHistorial(client, reservaId, userId, "cambio_destino_solicitado", {
      solicitud_id: inserted.rows[0].id,
      origen_anterior: reservation.origen,
      destino_anterior: reservation.destino,
      origen_solicitado: origen,
      destino_solicitado: destino,
    });
    await client.query("COMMIT");
    await notificarAdmins(userId, `El cliente solicitó cambiar la ruta de la reserva #${reservaId}.`, "reserva", reservaId);
    return res.status(201).json({ message: "Solicitud enviada. Administración revisará la ruta y el nuevo valor.", data: inserted.rows[0] });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error creando solicitud de cambio de destino:", error);
    return res.status(500).json({ error: "No se pudo enviar la solicitud de cambio" });
  } finally {
    client.release();
  }
};

const listarSolicitudesCambioDestinoCliente = async (req: any, res: any) => {
  const reservaId = Number(req.params.id);
  const userId = Number(req.user?.id);
  if (!Number.isInteger(reservaId) || reservaId <= 0 || !Number.isInteger(userId) || userId <= 0) {
    return res.status(400).json({ error: "Reserva o usuario inválido" });
  }
  try {
    const result = await pool.query(
      `SELECT s.id, s.reserva_id, s.estado, s.origen_solicitado, s.destino_solicitado,
              s.total_anterior, s.total_propuesto, s.nota_admin, s.creado_en, s.actualizado_en
       FROM solicitudes_cambio_destino s
       JOIN reservas r ON r.id = s.reserva_id
       WHERE s.reserva_id = $1 AND r.usuario_id = $2
       ORDER BY s.creado_en DESC, s.id DESC
       LIMIT 1`,
      [reservaId, userId]
    );
    return res.json(result.rows[0] || null);
  } catch (error) {
    console.error("Error consultando solicitud de cambio de destino:", error);
    return res.status(500).json({ error: "No se pudo consultar la solicitud" });
  }
};

const aceptarPropuestaCambioDestino = async (req: any, res: any) => {
  const requestId = Number(req.params.solicitudId);
  const userId = Number(req.user?.id);
  if (!Number.isInteger(requestId) || requestId <= 0 || !Number.isInteger(userId) || userId <= 0) {
    return res.status(400).json({ error: "Solicitud o usuario inválido" });
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const requestResult = await client.query(
      `SELECT s.*, r.estado AS reserva_estado, r.estado_pago, r.monto_pagado, r.recogido, r.estado_operativo
       FROM solicitudes_cambio_destino s
       JOIN reservas r ON r.id = s.reserva_id
       WHERE s.id = $1 AND s.usuario_id = $2
       FOR UPDATE OF s, r`,
      [requestId, userId]
    );
    if (!requestResult.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Propuesta no encontrada" });
    }
    const request = requestResult.rows[0];
    if (request.estado !== "propuesta_cliente") {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "La propuesta ya no está disponible" });
    }
    if (request.reserva_estado !== "confirmada" || request.estado_pago !== "pagado"
      || Math.abs(Number(request.total_anterior) - Number(request.monto_pagado)) > 0.01
      || request.recogido || request.estado_operativo === "en_curso"
      || await esOperacionIniciada(client, Number(request.reserva_id))
      || await hayOperacionesPreparadas(client, Number(request.reserva_id))) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "La reserva cambió o ya está en Despacho. Contacta a administración antes de aceptar" });
    }
    if (Math.abs(Number(request.total_anterior) - Number(request.total_propuesto)) < 0.005) {
      await aplicarRutaSolicitada(client, request);
      await client.query(
        `UPDATE solicitudes_cambio_destino
         SET estado = 'aplicada', aceptado_en = NOW(), aplicado_en = NOW(), actualizado_en = NOW()
         WHERE id = $1`,
        [requestId]
      );
      await registrarHistorial(client, Number(request.reserva_id), userId, "cambio_destino_aplicado", {
        solicitud_id: requestId,
        total_anterior: request.total_anterior,
        total_nuevo: request.total_propuesto,
      });
      await client.query("COMMIT");
      await crearNotificacion(userId, userId, "La ruta de tu reserva fue actualizada.", Number(request.reserva_id), "reserva", Number(request.reserva_id));
      return res.json({ message: "Propuesta aceptada. La nueva ruta quedó aplicada." });
    }
    if (Number(request.total_propuesto) > Number(request.total_anterior)) {
      const newTotal = Number(request.total_propuesto);
      const currentPaid = Number(request.monto_pagado) || 0;
      if (currentPaid >= newTotal - 0.01) {
        await aplicarRutaSolicitada(client, request);
        await client.query(
          `UPDATE solicitudes_cambio_destino
           SET estado = 'aplicada', aceptado_en = NOW(), aplicado_en = NOW(), actualizado_en = NOW()
           WHERE id = $1`,
          [requestId]
        );
        await registrarHistorial(client, Number(request.reserva_id), userId, "cambio_destino_aplicado", {
          solicitud_id: requestId,
          total_anterior: request.total_anterior,
          total_nuevo: newTotal,
        });
        await client.query("COMMIT");
        return res.json({ message: "Propuesta aceptada. La nueva ruta quedó aplicada." });
      }
      await client.query(
        `UPDATE reservas
         SET total = $1, estado_pago = 'parcial', estado = 'pendiente_pago', estado_operativo = NULL
         WHERE id = $2`,
        [newTotal, request.reserva_id]
      );
      await client.query(
        `UPDATE solicitudes_cambio_destino
         SET estado = 'pago_pendiente', aceptado_en = NOW(), actualizado_en = NOW()
         WHERE id = $1`,
        [requestId]
      );
      await registrarHistorial(client, Number(request.reserva_id), userId, "cambio_destino_aceptado_pago_pendiente", {
        solicitud_id: requestId,
        total_anterior: request.total_anterior,
        total_nuevo: newTotal,
        saldo_pendiente: Math.max(0, newTotal - currentPaid),
      });
      await client.query("COMMIT");
      return res.json({ message: `Propuesta aceptada. Paga la diferencia de $${Math.max(0, newTotal - currentPaid).toFixed(2)} para aplicar la nueva ruta.` });
    }
    await client.query(
      `UPDATE solicitudes_cambio_destino
       SET estado = 'devolucion_pendiente', aceptado_en = NOW(), actualizado_en = NOW()
       WHERE id = $1`,
      [requestId]
    );
    await registrarHistorial(client, Number(request.reserva_id), userId, "cambio_destino_aceptado_devolucion_pendiente", {
      solicitud_id: requestId,
      total_anterior: request.total_anterior,
      total_nuevo: request.total_propuesto,
      devolucion_pendiente: Number(request.total_anterior) - Number(request.total_propuesto),
    });
    await client.query("COMMIT");
    await notificarAdmins(userId, `El cliente aceptó el nuevo precio para la reserva #${request.reserva_id}; falta registrar la devolución externa.`, "reserva", Number(request.reserva_id));
    return res.json({ message: "Propuesta aceptada. Administración realizará y registrará la devolución antes de aplicar la ruta." });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error aceptando propuesta de cambio de destino:", error);
    return res.status(500).json({ error: "No se pudo aceptar la propuesta" });
  } finally {
    client.release();
  }
};

const rechazarPropuestaCambioDestino = async (req: any, res: any) => {
  const requestId = Number(req.params.solicitudId);
  const userId = Number(req.user?.id);
  if (!Number.isInteger(requestId) || requestId <= 0 || !Number.isInteger(userId) || userId <= 0) {
    return res.status(400).json({ error: "Solicitud o usuario inválido" });
  }
  try {
    const updated = await pool.query(
      `UPDATE solicitudes_cambio_destino s
       SET estado = 'rechazada_cliente', actualizado_en = NOW()
       FROM reservas r
       WHERE s.id = $1 AND s.usuario_id = $2 AND s.estado = 'propuesta_cliente'
         AND r.id = s.reserva_id AND r.usuario_id = $2
       RETURNING s.id, s.reserva_id`,
      [requestId, userId]
    );
    if (!updated.rowCount) return res.status(409).json({ error: "La propuesta ya no está disponible" });
    await pool.query(
      `INSERT INTO reserva_historial (reserva_id, usuario_id, accion, estado_anterior, estado_nuevo, detalle)
       VALUES ($1, $2, 'propuesta_cambio_destino_rechazada', 'confirmada', 'confirmada', $3::jsonb)`,
      [updated.rows[0].reserva_id, userId, JSON.stringify({ solicitud_id: requestId })]
    );
    await notificarAdmins(userId, `El cliente rechazó la propuesta de cambio de ruta para la reserva #${updated.rows[0].reserva_id}.`, "reserva", Number(updated.rows[0].reserva_id));
    return res.json({ message: "Propuesta rechazada. La reserva conserva su ruta original." });
  } catch (error) {
    console.error("Error rechazando propuesta de cambio de destino:", error);
    return res.status(500).json({ error: "No se pudo rechazar la propuesta" });
  }
};

const listarSolicitudesCambioDestinoAdmin = async (_req: any, res: any) => {
  try {
    const result = await pool.query(
      `SELECT s.*, u.nombre AS cliente_nombre, u.email AS cliente_email,
              r.estado AS reserva_estado, r.estado_pago, r.monto_pagado,
              (SELECT p.id FROM pagos_reserva p
               WHERE p.reserva_id = r.id AND p.estado = 'aprobado'
               ORDER BY p.creado_en DESC, p.id DESC LIMIT 1) AS pago_id
       FROM solicitudes_cambio_destino s
       JOIN reservas r ON r.id = s.reserva_id
       JOIN usuarios u ON u.id = s.usuario_id
       WHERE s.estado IN ('pendiente_admin', 'propuesta_cliente', 'pago_pendiente', 'devolucion_pendiente')
       ORDER BY s.creado_en ASC, s.id ASC`
    );
    return res.json(result.rows);
  } catch (error) {
    console.error("Error listando cambios de destino:", error);
    return res.status(500).json({ error: "No se pudieron cargar las solicitudes de cambio" });
  }
};

const proponerCambioDestino = async (req: any, res: any) => {
  const requestId = Number(req.params.solicitudId);
  const total = Number(req.body?.total_propuesto);
  const note = typeof req.body?.nota_admin === "string" ? req.body.nota_admin.trim() : "";
  if (!Number.isInteger(requestId) || requestId <= 0 || !Number.isFinite(total) || total <= 0
    || Math.round(total * 100) !== total * 100 || note.length < 5 || note.length > 500) {
    return res.status(400).json({ error: "Indica un nuevo total válido y una nota de al menos 5 caracteres" });
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const request = await client.query(
      `SELECT s.*, r.estado AS reserva_estado, r.estado_pago, r.monto_pagado, r.estado_operativo, r.recogido
       FROM solicitudes_cambio_destino s JOIN reservas r ON r.id = s.reserva_id
       WHERE s.id = $1 FOR UPDATE OF s, r`,
      [requestId]
    );
    if (!request.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Solicitud no encontrada" });
    }
    const item = request.rows[0];
    if (item.estado !== "pendiente_admin") {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "La solicitud ya fue atendida" });
    }
    if (item.reserva_estado !== "confirmada" || item.estado_pago !== "pagado"
      || Math.abs(Number(item.total_anterior) - Number(item.monto_pagado)) > 0.01
      || item.estado_operativo === "en_curso" || item.recogido
      || await esOperacionIniciada(client, Number(item.reserva_id))
      || await hayOperacionesPreparadas(client, Number(item.reserva_id))) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "La reserva ya cambió o tiene despacho preparado. Resuelve Despacho antes de cotizar el cambio" });
    }
    await client.query(
      `UPDATE solicitudes_cambio_destino
       SET estado = 'propuesta_cliente', total_propuesto = $1, nota_admin = $2,
           respondido_por = $3, actualizado_en = NOW()
       WHERE id = $4`,
      [total, note, req.user?.id || null, requestId]
    );
    await registrarHistorial(client, Number(item.reserva_id), Number(req.user?.id) || null, "propuesta_cambio_destino_enviada", {
      solicitud_id: requestId,
      total_anterior: item.total_anterior,
      total_propuesto: total,
      nota_admin: note,
    });
    await client.query("COMMIT");
    await crearNotificacion(req.user?.id, item.usuario_id, `Turesma envió una propuesta de precio para el cambio de ruta de la reserva #${item.reserva_id}.`, Number(item.reserva_id), "reserva", Number(item.reserva_id));
    return res.json({ message: "Propuesta enviada al cliente" });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error proponiendo cambio de destino:", error);
    return res.status(500).json({ error: "No se pudo enviar la propuesta" });
  } finally {
    client.release();
  }
};

const rechazarSolicitudCambioDestino = async (req: any, res: any) => {
  const requestId = Number(req.params.solicitudId);
  const note = typeof req.body?.nota_admin === "string" ? req.body.nota_admin.trim() : "";
  if (!Number.isInteger(requestId) || requestId <= 0 || note.length < 5 || note.length > 500) {
    return res.status(400).json({ error: "Indica un motivo de rechazo de al menos 5 caracteres" });
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `UPDATE solicitudes_cambio_destino
       SET estado = 'rechazada_admin', nota_admin = $1, respondido_por = $2, actualizado_en = NOW()
       WHERE id = $3 AND estado = 'pendiente_admin'
       RETURNING id, reserva_id, usuario_id`,
      [note, req.user?.id || null, requestId]
    );
    if (!result.rowCount) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "La solicitud ya fue atendida o no existe" });
    }
    await registrarHistorial(client, Number(result.rows[0].reserva_id), Number(req.user?.id) || null, "solicitud_cambio_destino_rechazada", {
      solicitud_id: requestId,
      nota_admin: note,
    });
    await client.query("COMMIT");
    await crearNotificacion(req.user?.id, result.rows[0].usuario_id, `La solicitud de cambio de ruta de la reserva #${result.rows[0].reserva_id} fue rechazada: ${note}`, Number(result.rows[0].reserva_id), "reserva", Number(result.rows[0].reserva_id));
    return res.json({ message: "Solicitud rechazada" });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error rechazando solicitud de cambio de destino:", error);
    return res.status(500).json({ error: "No se pudo rechazar la solicitud" });
  } finally {
    client.release();
  }
};

const registrarDevolucionCambioDestino = async (req: any, res: any) => {
  const requestId = Number(req.params.solicitudId);
  const reference = typeof req.body?.referencia_externa === "string" ? req.body.referencia_externa.trim() : "";
  if (!Number.isInteger(requestId) || requestId <= 0 || reference.length < 3 || reference.length > 120) {
    return res.status(400).json({ error: "Indica una referencia externa válida (3 a 120 caracteres)" });
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const requestResult = await client.query(
      `SELECT s.*, r.estado AS reserva_estado, r.estado_pago, r.monto_pagado
       FROM solicitudes_cambio_destino s JOIN reservas r ON r.id = s.reserva_id
       WHERE s.id = $1 FOR UPDATE OF s, r`,
      [requestId]
    );
    if (!requestResult.rowCount || requestResult.rows[0].estado !== "devolucion_pendiente") {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "La solicitud no está esperando una devolución" });
    }
    const request = requestResult.rows[0];
    if (request.reserva_estado !== "confirmada" || request.estado_pago !== "pagado"
      || Math.abs(Number(request.total_anterior) - Number(request.monto_pagado)) > 0.01
      || Math.abs(Number(request.total_anterior) - Number(request.total_propuesto)) < 0.01) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "El estado de pago o los importes de la reserva cambiaron" });
    }
    const amountToRefund = Math.round((Number(request.total_anterior) - Number(request.total_propuesto)) * 100) / 100;
    const payments = await client.query(
      `SELECT p.id, p.monto,
              COALESCE((SELECT SUM(rr.monto) FROM reembolsos_reserva rr WHERE rr.pago_id = p.id AND rr.estado = 'completado'), 0) AS reembolsado
       FROM pagos_reserva p
       WHERE p.reserva_id = $1 AND p.estado = 'aprobado'
       ORDER BY p.creado_en DESC, p.id DESC
       FOR UPDATE`,
      [request.reserva_id]
    );
    let remaining = amountToRefund;
    const allocations: Array<{ paymentId: number; amount: number }> = [];
    for (const payment of payments.rows) {
      const available = Math.max(0, Number(payment.monto) - Number(payment.reembolsado));
      const allocated = Math.min(available, remaining);
      if (allocated > 0.001) {
        allocations.push({ paymentId: Number(payment.id), amount: Math.round(allocated * 100) / 100 });
        remaining = Math.round((remaining - allocated) * 100) / 100;
      }
      if (remaining <= 0.001) break;
    }
    if (remaining > 0.001) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "No hay pagos aprobados suficientes para registrar la devolución completa" });
    }
    for (let index = 0; index < allocations.length; index += 1) {
      const allocation = allocations[index];
      const externalReference = allocations.length === 1
        ? reference
        : `${reference.slice(0, 100)}-parte-${index + 1}`;
      await client.query(
        `INSERT INTO reembolsos_reserva
           (pago_id, reserva_id, monto, motivo, referencia_externa, procesado_por, solicitud_cambio_destino_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          allocation.paymentId,
          request.reserva_id,
          allocation.amount,
          `Cambio de destino #${requestId}. Devolución externa ejecutada; referencia ${reference}`,
          externalReference,
          req.user?.id || null,
          requestId,
        ]
      );
    }
    await aplicarRutaSolicitada(client, request);
    await client.query(
      `UPDATE solicitudes_cambio_destino
       SET estado = 'aplicada', aplicado_en = NOW(), respondido_por = $1, actualizado_en = NOW()
       WHERE id = $2`,
      [req.user?.id || null, requestId]
    );
    await registrarHistorial(client, Number(request.reserva_id), Number(req.user?.id) || null, "cambio_destino_aplicado_devolucion", {
      solicitud_id: requestId,
      total_anterior: request.total_anterior,
      total_nuevo: request.total_propuesto,
      monto_devuelto: amountToRefund,
      referencia_externa: reference,
    });
    await client.query("COMMIT");
    await crearNotificacion(req.user?.id, request.usuario_id, `La nueva ruta de la reserva #${request.reserva_id} fue aplicada y se registró la devolución de $${amountToRefund.toFixed(2)}.`, Number(request.reserva_id), "reserva", Number(request.reserva_id));
    return res.json({ message: `Devolución de $${amountToRefund.toFixed(2)} registrada y nueva ruta aplicada` });
  } catch (error: any) {
    await client.query("ROLLBACK");
    if (error?.code === "23505") return res.status(409).json({ error: "La referencia de devolución ya fue registrada" });
    console.error("Error registrando devolución de cambio de destino:", error);
    return res.status(500).json({ error: "No se pudo registrar la devolución" });
  } finally {
    client.release();
  }
};

const aplicarCambioDestinoTrasPago = async (reservaId: number, actorId?: number | null) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const requestResult = await client.query(
      `SELECT s.*, r.estado AS reserva_estado, r.estado_pago
       FROM solicitudes_cambio_destino s JOIN reservas r ON r.id = s.reserva_id
       WHERE s.reserva_id = $1 AND s.estado = 'pago_pendiente'
       FOR UPDATE OF s, r`,
      [reservaId]
    );
    if (!requestResult.rowCount) {
      await client.query("COMMIT");
      return false;
    }
    const request = requestResult.rows[0];
    if (request.reserva_estado !== "confirmada" || request.estado_pago !== "pagado"
      || await esOperacionIniciada(client, reservaId)
      || await hayOperacionesPreparadas(client, reservaId)) {
      await client.query("ROLLBACK");
      return false;
    }
    await aplicarRutaSolicitada(client, request);
    await client.query(
      `UPDATE solicitudes_cambio_destino
       SET estado = 'aplicada', aplicado_en = NOW(), actualizado_en = NOW()
       WHERE id = $1`,
      [request.id]
    );
    await registrarHistorial(client, reservaId, Number(actorId) || null, "cambio_destino_aplicado_pago_confirmado", {
      solicitud_id: request.id,
      total_anterior: request.total_anterior,
      total_nuevo: request.total_propuesto,
    });
    await client.query("COMMIT");
    await crearNotificacion(actorId, request.usuario_id, `Se confirmó el pago de la diferencia y se aplicó la nueva ruta de la reserva #${reservaId}.`, reservaId, "reserva", reservaId);
    return true;
  } catch (error) {
    await client.query("ROLLBACK");
    console.error(`Error aplicando cambio de destino tras pago de reserva #${reservaId}:`, error);
    throw error;
  } finally {
    client.release();
  }
};

module.exports = {
  crearSolicitudCambioDestino,
  listarSolicitudesCambioDestinoCliente,
  aceptarPropuestaCambioDestino,
  rechazarPropuestaCambioDestino,
  listarSolicitudesCambioDestinoAdmin,
  proponerCambioDestino,
  rechazarSolicitudCambioDestino,
  registrarDevolucionCambioDestino,
  aplicarCambioDestinoTrasPago,
};
