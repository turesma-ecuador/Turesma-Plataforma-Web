export {};

const pool = require("../../config/db");
const { crearNotificacion, usuarioIdDeConductor } = require("../../config/notificaciones");
const { notificarClienteReserva } = require("../../config/reservaMailer");
const { emitirFacturaPorReserva, obtenerFactura, reenviarFacturaPorReserva } = require("../../config/sriFacturacion");
const { prepararDespachoRequerimiento } = require("../../config/requerimientosDespacho");
const { resolveStoredUploadPath } = require("../../config/storage");
const { crearUrlAccesoComprobante } = require("../../config/comprobanteAcceso");
const { aplicarCambioDestinoTrasPago } = require("../cambios-destino.controller");

// Recalcula monto_pagado y estado_pago de una reserva a partir de sus pagos
// APROBADOS. La reserva solo se confirma cuando el total está pagado. Cuando
// eso ocurre y la reserva todavía está 'pendiente_pago', queda confirmada y
// disponible para que Despacho la prepare. Si ya tiene conductor, se le notifica.
const recalcularEstadoPago = async (reservaId: number, adminId: number | null | undefined) => {
  const reservaRes = await pool.query("SELECT total, estado, conductor_id, origen, destino FROM reservas WHERE id = $1", [reservaId]);
  const reserva = reservaRes.rows[0];
  const total = Number(reserva?.total) || 0;

  const sumaRes = await pool.query(
    `SELECT
       COALESCE((SELECT SUM(monto) FROM pagos_reserva WHERE reserva_id = $1 AND estado = 'aprobado'), 0)
       - COALESCE((SELECT SUM(monto) FROM reembolsos_reserva WHERE reserva_id = $1), 0) AS suma,
       COALESCE((SELECT SUM(monto) FROM reembolsos_reserva WHERE reserva_id = $1), 0) AS reembolsado`,
    [reservaId]
  );
  const montoPagado = Number(sumaRes.rows[0].suma) || 0;
  const estadoPago = montoPagado <= 0
    ? Number(sumaRes.rows[0].reembolsado) > 0 ? "reembolsado" : "pendiente"
    : montoPagado >= total - 0.01
      ? "pagado"
      : "parcial";

  await pool.query(
    "UPDATE reservas SET monto_pagado = GREATEST(0, LEAST($1::numeric, total)), estado_pago = $2 WHERE id = $3",
    [montoPagado, estadoPago, reservaId]
  );

  let reservaConfirmada = false;
  if (estadoPago === "pagado" && reserva?.estado === "pendiente_pago") {
    await pool.query("UPDATE reservas SET estado = 'confirmada' WHERE id = $1 AND estado = 'pendiente_pago'", [reservaId]);
    reservaConfirmada = true;
    const condUserId = await usuarioIdDeConductor(reserva.conductor_id);
    if (condUserId) {
      await crearNotificacion(adminId, condUserId, `Nueva reserva confirmada #${reservaId}: ${reserva.origen} → ${reserva.destino}.`, reservaId, "reserva", reservaId);
    }
    // Avisar al cliente (campanita + correo) que su reserva quedó confirmada.
    await notificarClienteReserva(reservaId, "confirmada", adminId);
  }

  if (estadoPago === "pagado") {
    await aplicarCambioDestinoTrasPago(reservaId, adminId);
  }

  let despacho = null;
  if (estadoPago === "pagado") {
    try {
      despacho = await prepararDespachoRequerimiento(reservaId, adminId);
    } catch (error) {
      console.error(`Error preparando despacho del requerimiento para reserva #${reservaId}:`, error);
      despacho = { pendiente: true };
    }
  }

  return { montoPagado, estadoPago, total, reservaConfirmada, despacho };
};

// ── Admin: lista todos los comprobantes de pago (filtrable por estado) ───────
const listarPagosAdmin = async (req: any, res: any) => {
  try {
    const { estado } = req.query;
    const cond = estado && estado !== "todos" ? "WHERE p.estado = $1" : "";
    const params = estado && estado !== "todos" ? [estado] : [];

    const result = await pool.query(
      `SELECT p.*,
              r.total AS reserva_total, r.origen, r.destino, r.estado AS reserva_estado,
              r.monto_pagado AS reserva_monto_pagado, r.estado_pago AS reserva_estado_pago,
              u.nombre AS cliente_nombre, u.email AS cliente_email,
              COALESCE((SELECT SUM(rr.monto) FROM reembolsos_reserva rr WHERE rr.pago_id = p.id), 0) AS monto_reembolsado,
              COALESCE((
                SELECT json_agg(json_build_object(
                  'id', rr.id, 'monto', rr.monto, 'motivo', rr.motivo,
                  'referencia_externa', rr.referencia_externa, 'creado_en', rr.creado_en,
                  'procesado_por', COALESCE(ua.nombre, 'Usuario eliminado')
                ) ORDER BY rr.creado_en DESC)
                FROM reembolsos_reserva rr
                LEFT JOIN usuarios ua ON ua.id = rr.procesado_por
                WHERE rr.pago_id = p.id
              ), '[]'::json) AS reembolsos
       FROM pagos_reserva p
       JOIN reservas r ON r.id = p.reserva_id
       JOIN usuarios u ON u.id = p.usuario_id
       ${cond}
       ORDER BY p.creado_en DESC`,
      params
    );
    const pagos = result.rows.map((pago: any) => ({
      ...pago,
      comprobante_url: pago.comprobante_url
        ? crearUrlAccesoComprobante(pago.comprobante_url, Number(req.user?.id))
        : null,
    }));
    return res.status(200).json(pagos);
  } catch (error) {
    console.error("Error listando pagos (admin):", error);
    return res.status(500).json({ error: "Error interno del servidor" });
  }
};

const registrarReembolso = async (req: any, res: any) => {
  const pagoId = Number(req.params.id);
  const monto = Number(req.body?.monto);
  const motivo = typeof req.body?.motivo === "string" ? req.body.motivo.trim() : "";
  const referencia = typeof req.body?.referencia_externa === "string" ? req.body.referencia_externa.trim() : "";
  if (!Number.isInteger(pagoId) || pagoId <= 0 || !Number.isFinite(monto) || monto <= 0
    || Math.round(monto * 100) !== monto * 100 || motivo.length < 5 || motivo.length > 500
    || referencia.length < 3 || referencia.length > 120) {
    return res.status(400).json({ error: "Indica un monto válido, un motivo de al menos 5 caracteres y la referencia de la devolución realizada" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const paymentResult = await client.query(
      `SELECT p.id, p.reserva_id, p.monto, p.estado, r.total, r.estado AS reserva_estado
       FROM pagos_reserva p JOIN reservas r ON r.id = p.reserva_id
       WHERE p.id = $1 FOR UPDATE OF p, r`,
      [pagoId]
    );
    if (!paymentResult.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Pago no encontrado" });
    }
    const payment = paymentResult.rows[0];
    if (payment.estado !== "aprobado") {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Solo se pueden registrar devoluciones de pagos aprobados" });
    }
    const previousRefunds = await client.query(
      "SELECT COALESCE(SUM(monto), 0) AS total FROM reembolsos_reserva WHERE pago_id = $1",
      [pagoId]
    );
    const remainingOnPayment = Number(payment.monto) - Number(previousRefunds.rows[0].total);
    if (monto > remainingOnPayment + 0.001) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: `El pago solo tiene $${Math.max(0, remainingOnPayment).toFixed(2)} disponible para devolver` });
    }
    const balance = await client.query(
      `SELECT
         COALESCE((SELECT SUM(monto) FROM pagos_reserva WHERE reserva_id = $1 AND estado = 'aprobado'), 0)
         - COALESCE((SELECT SUM(monto) FROM reembolsos_reserva WHERE reserva_id = $1), 0) AS neto,
         COALESCE((SELECT SUM(monto) FROM reembolsos_reserva WHERE reserva_id = $1), 0) AS devuelto`,
      [payment.reserva_id]
    );
    const netAfterRefund = Number(balance.rows[0].neto) - monto;
    if (netAfterRefund < -0.001) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "La devolución supera el monto neto pagado en la reserva" });
    }
    if (netAfterRefund <= 0.01 && payment.reserva_estado !== "cancelada") {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Para devolver el saldo total pagado, primero debe cancelarse la reserva" });
    }

    const saved = await client.query(
      `INSERT INTO reembolsos_reserva (pago_id, reserva_id, monto, motivo, referencia_externa, procesado_por)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, pago_id, reserva_id, monto, motivo, referencia_externa, creado_en`,
      [pagoId, payment.reserva_id, monto, motivo, referencia, req.user?.id || null]
    );
    const remaining = Math.max(0, netAfterRefund);
    const refunded = Number(balance.rows[0].devuelto) + monto;
    const paymentState = remaining <= 0.01
      ? "reembolsado"
      : remaining >= Number(payment.total) - 0.01
        ? "pagado"
        : "parcial";
    await client.query(
      "UPDATE reservas SET monto_pagado = $1, estado_pago = $2 WHERE id = $3",
      [remaining, paymentState, payment.reserva_id]
    );
    await client.query(
      `INSERT INTO reserva_historial (reserva_id, usuario_id, accion, estado_anterior, estado_nuevo, detalle)
       VALUES ($1, $2, 'reembolso_registrado', $3, $3, $4::jsonb)`,
      [
        payment.reserva_id,
        req.user?.id || null,
        payment.reserva_estado,
        JSON.stringify({ pago_id: pagoId, monto, motivo, referencia_externa: referencia }),
      ]
    );
    await client.query("COMMIT");
    return res.status(201).json({
      message: "Se registró la devolución efectuada fuera del sistema. No se transfirió dinero desde Turesma.",
      reembolso: saved.rows[0],
      monto_pagado_neto: remaining,
      monto_reembolsado_total: refunded,
      estado_pago: paymentState,
    });
  } catch (error: any) {
    await client.query("ROLLBACK");
    if (error?.code === "23505") return res.status(409).json({ error: "La referencia de devolución ya está registrada" });
    console.error("Error registrando devolución de pago:", error);
    return res.status(500).json({ error: "No se pudo registrar la devolución" });
  } finally {
    client.release();
  }
};

const descargarReciboPagoAdmin = async (req: any, res: any) => {
  const pagoId = Number(req.params.id);
  if (!Number.isInteger(pagoId) || pagoId <= 0) {
    return res.status(400).json({ error: "ID de pago inválido" });
  }

  try {
    const pago = await pool.query(
      `SELECT p.reserva_id
       FROM pagos_reserva p
       WHERE p.id = $1 AND p.estado = 'aprobado'
       LIMIT 1`,
      [pagoId]
    );
    if (!pago.rowCount) return res.status(404).json({ error: "Pago no encontrado o aún no aprobado" });

    const factura = await obtenerFactura(pago.rows[0].reserva_id);
    if (!factura || factura.estado !== "autorizada" || !factura.pdf_url) {
      return res.status(404).json({ error: "La factura de esta reserva todavía no está autorizada" });
    }

    const filePath = resolveStoredUploadPath(factura.pdf_url);
    if (!require("fs").existsSync(filePath)) return res.status(404).json({ error: "Archivo de factura no encontrado" });
    return res.download(filePath, `factura_${factura.clave_acceso}.pdf`);
  } catch (error) {
    console.error("Error descargando factura desde pagos para administración:", error);
    return res.status(500).json({ error: "No se pudo descargar la factura" });
  }
};

const descargarFacturaAdmin = async (req: any, res: any) => {
  const reservaId = Number(req.params.id);
  if (!Number.isInteger(reservaId) || reservaId <= 0) return res.status(400).json({ error: "ID de reserva inválido" });
  try {
    const factura = await obtenerFactura(reservaId);
    if (!factura || factura.estado !== "autorizada") return res.status(404).json({ error: "La factura todavía no está autorizada" });
    const filePath = resolveStoredUploadPath(factura.pdf_url);
    if (!require("fs").existsSync(filePath)) return res.status(404).json({ error: "Archivo de factura no encontrado" });
    return res.download(filePath, `factura_${factura.clave_acceso}.pdf`);
  } catch (error) {
    console.error("Error descargando factura para administración:", error);
    return res.status(500).json({ error: "No se pudo descargar la factura" });
  }
};

const emitirFacturaAdmin = async (req: any, res: any) => {
  const reservaId = Number(req.params.id);
  if (!Number.isInteger(reservaId) || reservaId <= 0) return res.status(400).json({ error: "ID de reserva inválido" });
  try {
    const factura = await emitirFacturaPorReserva(reservaId);
    return res.status(200).json({ message: "Factura emitida y autorizada por el SRI", factura });
  } catch (error: any) {
    console.error(`Error reintentando factura SRI para reserva #${reservaId}:`, error?.message || error);
    return res.status(502).json({ error: error?.message || "No se pudo emitir la factura ante el SRI" });
  }
};

const reenviarFacturaAdmin = async (req: any, res: any) => {
  const reservaId = Number(req.params.id);
  if (!Number.isInteger(reservaId) || reservaId <= 0) return res.status(400).json({ error: "ID de reserva inválido" });
  try {
    const result = await reenviarFacturaPorReserva(reservaId);
    return res.status(200).json({ message: `Factura reenviada a ${result.email}` });
  } catch (error: any) {
    console.error(`Error reenviando factura de reserva #${reservaId}:`, error?.message || error);
    return res.status(502).json({ error: error?.message || "No se pudo reenviar la factura" });
  }
};

// ── Admin: aprueba un comprobante de pago ────────────────────────────────────
const aprobarPago = async (req: any, res: any) => {
  const pagoId = Number(req.params.id);
  if (!Number.isInteger(pagoId) || pagoId <= 0) return res.status(400).json({ error: "ID de pago inválido" });

  try {
    const pago = await pool.query("SELECT * FROM pagos_reserva WHERE id = $1 LIMIT 1", [pagoId]);
    if (pago.rowCount === 0) return res.status(404).json({ error: "Pago no encontrado" });
    if (pago.rows[0].estado !== "pendiente") return res.status(400).json({ error: "Este pago ya fue revisado" });

    await pool.query("UPDATE pagos_reserva SET estado = 'aprobado', revisado_en = NOW() WHERE id = $1", [pagoId]);
    const { montoPagado, estadoPago, reservaConfirmada } = await recalcularEstadoPago(pago.rows[0].reserva_id, req.user?.id);

    const monto = Number(pago.rows[0].monto).toFixed(2);
    const mensaje = reservaConfirmada
      ? `Tu pago de $${monto} fue APROBADO. ¡Tu reserva #${pago.rows[0].reserva_id} quedó CONFIRMADA!`
      : estadoPago === "pagado"
        ? `Tu pago de $${monto} fue APROBADO. La reserva #${pago.rows[0].reserva_id} está pagada completamente.`
        : `Tu pago de $${monto} fue APROBADO para la reserva #${pago.rows[0].reserva_id}. Aún falta completar el pago total.`;
    await crearNotificacion(req.user?.id, pago.rows[0].usuario_id, mensaje, pago.rows[0].reserva_id, "reserva", pago.rows[0].reserva_id);

    return res.status(200).json({ message: "Pago aprobado", monto_pagado: montoPagado, estado_pago: estadoPago, reserva_confirmada: reservaConfirmada });
  } catch (error) {
    console.error("Error aprobando pago:", error);
    return res.status(500).json({ error: "Error interno del servidor" });
  }
};

// ── Admin: rechaza un comprobante de pago (con nota opcional) ────────────────
const rechazarPago = async (req: any, res: any) => {
  const pagoId = Number(req.params.id);
  const notas = typeof req.body.notas === "string" ? req.body.notas.trim().slice(0, 500) : null;
  if (!Number.isInteger(pagoId) || pagoId <= 0) return res.status(400).json({ error: "ID de pago inválido" });

  try {
    const pago = await pool.query("SELECT * FROM pagos_reserva WHERE id = $1 LIMIT 1", [pagoId]);
    if (pago.rowCount === 0) return res.status(404).json({ error: "Pago no encontrado" });
    if (pago.rows[0].estado !== "pendiente") return res.status(400).json({ error: "Este pago ya fue revisado" });

    await pool.query(
      "UPDATE pagos_reserva SET estado = 'rechazado', notas_admin = $1, revisado_en = NOW() WHERE id = $2",
      [notas, pagoId]
    );
    await crearNotificacion(
      req.user?.id,
      pago.rows[0].usuario_id,
      `Tu comprobante de pago para la reserva #${pago.rows[0].reserva_id} fue RECHAZADO${notas ? ": " + notas : ""}. Puedes volver a intentarlo.`,
      pago.rows[0].reserva_id,
      "reserva",
      pago.rows[0].reserva_id
    );

    return res.status(200).json({ message: "Pago rechazado" });
  } catch (error) {
    console.error("Error rechazando pago:", error);
    return res.status(500).json({ error: "Error interno del servidor" });
  }
};

// ── Admin: asigna/edita el link de pago de una reserva ───────────────────────
const actualizarLinkPago = async (req: any, res: any) => {
  const reservaId = Number(req.params.id);
  const linkPago = typeof req.body.link_pago === "string" ? req.body.link_pago.trim().slice(0, 500) : null;
  if (!Number.isInteger(reservaId) || reservaId <= 0) return res.status(400).json({ error: "ID de reserva inválido" });

  try {
    const result = await pool.query(
      "UPDATE reservas SET link_pago = $1 WHERE id = $2 RETURNING id, usuario_id",
      [linkPago || null, reservaId]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: "Reserva no encontrada" });

    if (linkPago) {
      await crearNotificacion(
        req.user?.id,
        result.rows[0].usuario_id,
        `El administrador envió un link de pago para tu reserva #${reservaId}.`,
        reservaId,
        "reserva",
        reservaId
      );
    }

    return res.status(200).json({ message: "Link de pago actualizado" });
  } catch (error) {
    console.error("Error actualizando link de pago:", error);
    return res.status(500).json({ error: "Error interno del servidor" });
  }
};

// ── Admin: registra manualmente un saldo recibido ───────────────────────────
const registrarPagoManual = async (req: any, res: any) => {
  const reservaId = Number(req.params.id);
  const montoSolicitado = Number(req.body?.monto);
  const nota = typeof req.body?.nota === "string" ? req.body.nota.trim().slice(0, 500) : null;

  if (!Number.isInteger(reservaId) || reservaId <= 0 || !Number.isFinite(montoSolicitado) || montoSolicitado <= 0) {
    return res.status(400).json({ error: "Indica un monto válido para el pago" });
  }

  try {
    const reservaRes = await pool.query(
      "SELECT id, usuario_id, total, estado, COALESCE(monto_pagado, 0) AS monto_pagado FROM reservas WHERE id = $1 LIMIT 1",
      [reservaId]
    );
    if (reservaRes.rowCount === 0) return res.status(404).json({ error: "Reserva no encontrada" });

    const reserva = reservaRes.rows[0];
    const total = Number(reserva.total) || 0;
    const pagado = Number(reserva.monto_pagado) || 0;
    const monto = Math.min(montoSolicitado, Math.max(0, total - pagado));
    if (monto <= 0) return res.status(400).json({ error: "La reserva ya tiene el valor total pagado" });

    await pool.query(
      `INSERT INTO pagos_reserva
        (reserva_id, usuario_id, monto, metodo, estado, notas_admin, revisado_en)
       VALUES ($1, $2, $3, 'ajuste_admin', 'aprobado', $4, NOW())`,
      [reservaId, reserva.usuario_id, monto, nota || "Pago confirmado manualmente por el administrador"]
    );

    const resultado = await recalcularEstadoPago(reservaId, req.user?.id);
    await crearNotificacion(
      req.user?.id,
      reserva.usuario_id,
      `El administrador registró un pago de $${monto.toFixed(2)} para la reserva #${reservaId}.`,
      reservaId,
      "reserva",
      reservaId
    );

    return res.status(200).json({
      message: "Pago registrado correctamente",
      ...resultado,
      saldo_pendiente: Math.max(0, resultado.total - resultado.montoPagado),
    });
  } catch (error) {
    console.error("Error registrando pago manual:", error);
    return res.status(500).json({ error: "Error interno del servidor" });
  }
};

module.exports = {
  listarPagosAdmin,
  descargarReciboPagoAdmin,
  descargarFacturaAdmin,
  emitirFacturaAdmin,
  reenviarFacturaAdmin,
  aprobarPago,
  rechazarPago,
  actualizarLinkPago,
  registrarPagoManual,
  registrarReembolso,
};
