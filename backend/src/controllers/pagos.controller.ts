export {};

const pool = require("../config/db");
const { notificarAdmins } = require("../config/notificaciones");
const { createPayphonePayment, confirmPayphonePayment } = require("../config/payphone");
const { obtenerPagoAprobado, enviarReciboPago } = require("../config/reciboPago");
const { obtenerFactura } = require("../config/sriFacturacion");
const { emitirFacturaPorReserva } = require("../config/sriFacturacion");
const { buildProformaDataDeReserva, generarProformaPDF } = require("../config/proforma");
const { prepararDespachoRequerimiento } = require("../config/requerimientosDespacho");
const { resolveStoredUploadPath } = require("../config/storage");

const METODOS_VALIDOS = ["transferencia", "link_pago", "payphone"];

const getPaymentInfo = async (reservaId: number, userId: number) => {
  const result = await pool.query(
    `SELECT id, usuario_id, estado, total, COALESCE(monto_pagado, 0) AS monto_pagado
     FROM reservas WHERE id = $1 AND usuario_id = $2 LIMIT 1`, [reservaId, userId]
  );
  return result.rows[0];
};

const validarMonto = (reserva: any, monto: number) => {
  const remaining = Math.max(0, Number(reserva.total) - Number(reserva.monto_pagado));
  if (monto < remaining - 0.01) throw new Error(`Debes pagar el total pendiente de $${remaining.toFixed(2)}`);
  if (monto > remaining + 0.01) throw new Error(`El pago no puede superar el saldo de $${remaining.toFixed(2)}`);
};

const crearPagoPayphone = async (req: any, res: any) => {
  const userId = req.user?.id;
  const reservaId = Number(req.params.id);
  const monto = Number(String(req.body?.monto ?? "").replace(",", "."));
  if (!userId || !Number.isInteger(reservaId)) return res.status(400).json({ error: "Datos de pago inválidos" });
  if (!Number.isFinite(monto) || monto < 1) return res.status(400).json({ error: "El monto mínimo para pagar con PayPhone es $1.00" });
  try {
    const reserva = await getPaymentInfo(reservaId, userId);
    if (!reserva) return res.status(404).json({ error: "Reserva no encontrada" });
    if (["cancelada", "finalizada"].includes(reserva.estado)) return res.status(400).json({ error: "Esta reserva no admite pagos" });
    validarMonto(reserva, monto);
    const clientTransactionId = `turesma-reserva-${reservaId}-${Date.now()}`.slice(0, 50);
    const webUrl = String(process.env.WEB_URL || "http://localhost:3000").replace(/\/+$/, "");
    const payment = await createPayphonePayment({
      amount: monto,
      clientTransactionId,
      reference: `Pago reserva Turesma #${reservaId}`,
      responseUrl: `${webUrl}/cliente/historial?payphone=ok&reserva_id=${reservaId}`,
      cancellationUrl: `${webUrl}/cliente/historial?payphone=cancelado&reserva_id=${reservaId}`,
    });
    if (!payment.payWithCard || !payment.paymentId) {
      throw new Error("PayPhone no devolvió el enlace de pago con tarjeta");
    }
    return res.json({ payment_id: payment.paymentId, client_transaction_id: clientTransactionId, payment_url: payment.payWithCard });
  } catch (error: any) {
    console.error("Error creando pago PayPhone:", error);
    return res.status(400).json({ error: error.message || "No se pudo iniciar el pago PayPhone" });
  }
};

const confirmarPagoPayphone = async (req: any, res: any) => {
  const userId = req.user?.id;
  const reservaId = Number(req.params.id);
  const paymentId = String(req.body?.payment_id || "");
  const clientTransactionId = String(req.body?.client_transaction_id || "");
  if (!userId || !Number.isInteger(reservaId) || !paymentId || !clientTransactionId) return res.status(400).json({ error: "Datos de confirmación inválidos" });
  if (!clientTransactionId.startsWith(`turesma-reserva-${reservaId}-`)) return res.status(400).json({ error: "La transacción no corresponde a la reserva" });
  try {
    const payment = await confirmPayphonePayment({ id: paymentId, clientTransactionId });
    const status = String(payment.status || payment.transactionStatus || "").toLowerCase();
    if (!["approved", "completed", "success", "3"].includes(status)) {
      return res.status(400).json({ error: "PayPhone no confirmó el pago" });
    }
    const monto = Number(payment.amount || payment.amountWithTax || 0) / 100;
    if (!Number.isFinite(monto) || monto <= 0) return res.status(400).json({ error: "PayPhone devolvió un monto inválido" });
    const client = await pool.connect();
    let reserva: any;
    let saved: any;
    let estadoPago: string;
    let totalPagado: number;
    try {
      await client.query("BEGIN");
      const reservaResult = await client.query(
        `SELECT id, usuario_id, estado, total, COALESCE(monto_pagado, 0) AS monto_pagado
         FROM reservas WHERE id = $1 AND usuario_id = $2 FOR UPDATE`,
        [reservaId, userId]
      );
      if (!reservaResult.rowCount) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "Reserva no encontrada" });
      }
      reserva = reservaResult.rows[0];
      if (["cancelada", "finalizada"].includes(reserva.estado)) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "Esta reserva no admite pagos" });
      }
      validarMonto(reserva, monto);
      const duplicate = await client.query("SELECT id FROM pagos_reserva WHERE metodo = 'payphone' AND proveedor_id = $1 LIMIT 1", [paymentId]);
      if (duplicate.rowCount) {
        await client.query("ROLLBACK");
        return res.status(409).json({ error: "Este pago PayPhone ya fue registrado" });
      }
      saved = await client.query(
        `INSERT INTO pagos_reserva (reserva_id, usuario_id, monto, metodo, proveedor_id, estado, revisado_en)
         VALUES ($1, $2, $3, 'payphone', $4, 'aprobado', NOW())
         RETURNING id, monto, estado`,
        [reservaId, userId, monto, paymentId]
      );
      const suma = await client.query(
        `SELECT
           COALESCE((SELECT SUM(monto) FROM pagos_reserva WHERE reserva_id = $1 AND estado = 'aprobado'), 0)
           - COALESCE((SELECT SUM(monto) FROM reembolsos_reserva WHERE reserva_id = $1), 0) AS total`,
        [reservaId]
      );
      totalPagado = Number(suma.rows[0].total);
      estadoPago = totalPagado >= Number(reserva.total) - 0.01
        ? "pagado"
        : totalPagado > 0 ? "parcial" : "reembolsado";
      await client.query(
        "UPDATE reservas SET monto_pagado = $1, estado_pago = $2 WHERE id = $3",
        [totalPagado, estadoPago, reservaId]
      );
      await client.query("COMMIT");
    } catch (error: any) {
      await client.query("ROLLBACK");
      if (error?.code === "23505") return res.status(409).json({ error: "Este pago PayPhone ya fue registrado" });
      throw error;
    } finally {
      client.release();
    }

    if (estadoPago === "pagado") {
      await pool.query(
        "UPDATE reservas SET estado = 'confirmada' WHERE id = $1 AND estado = 'pendiente_pago'",
        [reservaId]
      );
      try {
        await emitirFacturaPorReserva(reservaId);
      } catch (error: any) {
        console.error(`Error emitiendo factura SRI para reserva #${reservaId}:`, error?.message || error);
      }
    }
    let despacho = null;
    if (estadoPago === "pagado") {
      try {
        despacho = await prepararDespachoRequerimiento(reservaId, userId);
      } catch (error) {
        console.error(`Error preparando despacho del requerimiento para reserva #${reservaId}:`, error);
        despacho = { pendiente: true };
      }
    }
    await notificarAdmins(userId, `Pago PayPhone confirmado para la reserva #${reservaId} ($${monto.toFixed(2)}).`, "reserva", reservaId);
    return res.json({ message: "Pago PayPhone confirmado", pago: saved.rows[0], estado_pago: estadoPago, despacho });
  } catch (error: any) {
    console.error("Error confirmando pago PayPhone:", error);
    return res.status(400).json({ error: error.message || "No se pudo confirmar el pago PayPhone" });
  }
};

// ── Cliente: sube un comprobante de pago (transferencia o link de pago) ──────
const crearPagoReserva = async (req: any, res: any) => {
  const userId = req.user?.id;
  const reservaId = Number(req.params.id);
  const monto = Number(req.body.monto);
  const metodo = String(req.body.metodo || "transferencia").toLowerCase();
  const comprobanteUrl = typeof req.body.comprobante_url === "string" ? req.body.comprobante_url.trim() : "";

  if (!userId) return res.status(401).json({ error: "No autenticado" });
  if (!Number.isInteger(reservaId) || reservaId <= 0) return res.status(400).json({ error: "ID de reserva inválido" });
  if (!Number.isFinite(monto) || monto <= 0) return res.status(400).json({ error: "Ingresa un monto válido" });
  if (!METODOS_VALIDOS.includes(metodo)) return res.status(400).json({ error: "Método de pago inválido" });
  if (metodo !== "payphone" && !comprobanteUrl) return res.status(400).json({ error: "Debes adjuntar una imagen del comprobante" });

  try {
    const check = await getPaymentInfo(reservaId, userId);
    if (!check) return res.status(404).json({ error: "Reserva no encontrada" });
    if (check.estado === "cancelada") return res.status(400).json({ error: "Esta reserva está cancelada" });
    validarMonto(check, monto);

    const result = await pool.query(
      `INSERT INTO pagos_reserva (reserva_id, usuario_id, monto, metodo, comprobante_url, estado)
       VALUES ($1, $2, $3, $4, $5, 'pendiente')
       RETURNING *`,
      [reservaId, userId, monto, metodo, comprobanteUrl]
    );

    await notificarAdmins(
      userId,
      `Nuevo comprobante de pago recibido para la reserva #${reservaId} ($${monto.toFixed(2)}). Pendiente de revisión.`,
      "reserva",
      reservaId
    );

    return res.status(201).json({ message: "Comprobante enviado. El administrador lo revisará pronto.", data: result.rows[0] });
  } catch (error) {
    console.error("Error registrando pago:", error);
    return res.status(500).json({ error: "Error interno del servidor" });
  }
};

// ── Cliente: ve los pagos que ha subido para UNA de sus reservas ─────────────
const listarPagosDeReserva = async (req: any, res: any) => {
  const userId = req.user?.id;
  const reservaId = Number(req.params.id);

  if (!userId) return res.status(401).json({ error: "No autenticado" });
  if (!Number.isInteger(reservaId) || reservaId <= 0) return res.status(400).json({ error: "ID de reserva inválido" });

  try {
    const check = await pool.query("SELECT id FROM reservas WHERE id = $1 AND usuario_id = $2 LIMIT 1", [reservaId, userId]);
    if (check.rowCount === 0) return res.status(404).json({ error: "Reserva no encontrada" });

    const result = await pool.query(
      `SELECT id, monto, metodo, comprobante_url, estado, notas_admin, creado_en, revisado_en
       FROM pagos_reserva
       WHERE reserva_id = $1
       ORDER BY creado_en DESC`,
      [reservaId]
    );
    return res.status(200).json(result.rows);
  } catch (error) {
    console.error("Error listando pagos de la reserva:", error);
    return res.status(500).json({ error: "Error interno del servidor" });
  }
};

const descargarReciboPago = async (req: any, res: any) => {
  const userId = Number(req.user?.id);
  const reservaId = Number(req.params.id);
  const pagoId = Number(req.params.pagoId);
  if (!Number.isInteger(userId) || userId <= 0
    || !Number.isInteger(reservaId) || reservaId <= 0
    || !Number.isInteger(pagoId) || pagoId <= 0) {
    return res.status(400).json({ error: "Datos de recibo inválidos" });
  }

  try {
    const pago = await obtenerPagoAprobado(pagoId, userId);
    if (!pago || Number(pago.reserva_id) !== reservaId) {
      return res.status(404).json({ error: "Recibo no encontrado o pago aún no aprobado" });
    }
    return await enviarReciboPago(res, pago);
  } catch (error) {
    console.error("Error generando recibo de pago para cliente:", error);
    return res.status(500).json({ error: "No se pudo generar el recibo de pago" });
  }
};

const descargarProformaReserva = async (req: any, res: any) => {
  const userId = Number(req.user?.id);
  const reservaId = Number(req.params.id);
  if (!Number.isInteger(userId) || userId <= 0
    || !Number.isInteger(reservaId) || reservaId <= 0) {
    return res.status(400).json({ error: "Datos de proforma inválidos" });
  }

  try {
    const data = await buildProformaDataDeReserva(reservaId, userId);
    if (!data) return res.status(404).json({ error: "Reserva no encontrada" });
    if (!Number.isFinite(Number(data.precio)) || Number(data.precio) <= 0) {
      return res.status(400).json({ error: "La reserva todavía no tiene un precio para generar la proforma" });
    }

    const pdf = await generarProformaPDF(data);
    const numero = String(data.numero).replace(/[^a-zA-Z0-9_-]/g, "");
    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="proforma_${numero}.pdf"`,
      "Cache-Control": "private, no-store",
    });
    return res.status(200).send(pdf);
  } catch (error) {
    console.error("Error generando proforma para cliente:", error);
    return res.status(500).json({ error: "No se pudo generar la proforma" });
  }
};

const descargarFactura = async (req: any, res: any) => {
  const userId = Number(req.user?.id);
  const reservaId = Number(req.params.id);
  if (!Number.isInteger(userId) || !Number.isInteger(reservaId)) return res.status(400).json({ error: "Datos de factura inválidos" });
  try {
    const owns = await pool.query("SELECT id FROM reservas WHERE id = $1 AND usuario_id = $2 LIMIT 1", [reservaId, userId]);
    if (!owns.rowCount) return res.status(404).json({ error: "Reserva no encontrada" });
    const reserva = await pool.query(
      "SELECT estado_pago FROM reservas WHERE id = $1 AND usuario_id = $2 LIMIT 1",
      [reservaId, userId]
    );
    if (!reserva.rowCount || reserva.rows[0].estado_pago !== "pagado") {
      return res.status(400).json({ error: "La factura estará disponible cuando la reserva esté completamente pagada" });
    }

    let factura = await obtenerFactura(reservaId);
    if (!factura || factura.estado !== "autorizada") {
      try {
        factura = await emitirFacturaPorReserva(reservaId);
      } catch (error: any) {
        console.error(`Error reintentando factura SRI para reserva #${reservaId}:`, error?.message || error);
        return res.status(502).json({ error: error?.message || "El SRI todavía no ha autorizado esta factura" });
      }
    }
    const filePath = resolveStoredUploadPath(factura.pdf_url);
    if (!require("fs").existsSync(filePath)) return res.status(404).json({ error: "Archivo de factura no encontrado" });
    return res.download(filePath, `factura_${factura.clave_acceso}.pdf`);
  } catch (error) {
    console.error("Error descargando factura:", error);
    return res.status(500).json({ error: "No se pudo descargar la factura" });
  }
};

module.exports = {
  crearPagoReserva,
  listarPagosDeReserva,
  descargarReciboPago,
  descargarProformaReserva,
  descargarFactura,
  crearPagoPayphone,
  confirmarPagoPayphone,
};
