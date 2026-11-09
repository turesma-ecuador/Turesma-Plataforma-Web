export {};

const pool = require("./db");
const PDFDocument = require("pdfkit");

const EMPRESA = {
  nombre: "TURESMA S.A.",
  razon: "TURISMO ESMERALDA S.A. TURESMA",
  ruc: "1391763581001",
  email: "turesmasa@hotmail.com",
};

const fmtUSD = (value: unknown) =>
  `$${Number(value || 0).toLocaleString("es-EC", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fmtFecha = (value: unknown) => {
  if (!value) return "—";
  const date = new Date(value as string | number | Date);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("es-EC", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "America/Guayaquil",
  });
};

const obtenerPagoAprobado = async (pagoId: number, usuarioId?: number) => {
  const result = await pool.query(
    `SELECT p.id, p.reserva_id, p.monto, p.metodo, p.proveedor_id, p.creado_en,
            p.revisado_en, r.total AS reserva_total, r.monto_pagado,
            r.estado_pago, r.origen, r.destino, u.nombre AS cliente_nombre,
            u.email AS cliente_email, u.cedula AS cliente_cedula,
            u.tipo_identificacion AS cliente_tipo_identificacion
     FROM pagos_reserva p
     JOIN reservas r ON r.id = p.reserva_id
     JOIN usuarios u ON u.id = p.usuario_id
     WHERE p.id = $1
       AND p.estado = 'aprobado'
       AND ($2::int IS NULL OR (r.usuario_id = $2 AND p.usuario_id = $2))
     LIMIT 1`,
    [pagoId, usuarioId ?? null]
  );
  return result.rows[0] || null;
};

const generarReciboPago = (pago: any): Promise<Buffer> => new Promise((resolve, reject) => {
  try {
    const doc = new PDFDocument({ size: "A4", margin: 48 });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const left = 48;
    const right = 547;
    const width = right - left;

    doc.rect(0, 0, 595, 112).fill("#0b0f1a");
    doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(22)
      .text(EMPRESA.nombre, left, 34, { width, align: "center" });
    doc.fillColor("#cbd5e1").font("Helvetica").fontSize(9)
      .text(`RUC: ${EMPRESA.ruc}  |  ${EMPRESA.razon}`, left, 66, { width, align: "center" });
    doc.fillColor("#e31e24").rect(left, 111, width, 4).fill();

    doc.fillColor("#0b0f1a").font("Helvetica-Bold").fontSize(17)
      .text("RECIBO DE PAGO", left, 145, { width, align: "center" });
    doc.fillColor("#059669").font("Helvetica-Bold").fontSize(10)
      .text("PAGO APROBADO", left, 174, { width, align: "center" });
    doc.fillColor("#64748b").font("Helvetica").fontSize(9)
      .text("Constancia electrónica de pago registrada en el sistema TURESMA", left, 192, { width, align: "center" });

    const detailY = 235;
    const rowHeight = 34;
    const details: Array<[string, string]> = [
      ["N.° de recibo", `REC-${String(pago.id).padStart(6, "0")}`],
      ["Fecha de pago aprobado", fmtFecha(pago.revisado_en || pago.creado_en)],
      ["Cliente", String(pago.cliente_nombre || "—")],
      [pago.cliente_tipo_identificacion === "pasaporte" ? "Pasaporte" : pago.cliente_tipo_identificacion === "ruc" ? "RUC" : "Cédula", String(pago.cliente_cedula || "—")],
      ["Correo", String(pago.cliente_email || "—")],
      ["Reserva", `#${pago.reserva_id}`],
      ["Ruta", `${pago.origen || "—"} -> ${pago.destino || "—"}`],
      ["Método de pago", String(pago.metodo || "—").replace(/_/g, " ")],
      ["Identificador de transacción", String(pago.proveedor_id || "No aplica")],
      ["Monto de este pago", fmtUSD(pago.monto)],
      ["Total pagado de la reserva", fmtUSD(pago.monto_pagado)],
      ["Saldo pendiente", fmtUSD(Math.max(0, Number(pago.reserva_total) - Number(pago.monto_pagado)))],
    ];

    details.forEach(([label, value], index) => {
      const y = detailY + index * rowHeight;
      if (index % 2 === 0) doc.rect(left, y - 5, width, rowHeight).fill("#f8fafc");
      doc.fillColor("#64748b").font("Helvetica").fontSize(9).text(label, left + 10, y + 4, { width: 190 });
      doc.fillColor("#0f172a").font("Helvetica-Bold").fontSize(9)
        .text(value, left + 205, y + 4, { width: width - 220, align: "right" });
    });

    const footerY = detailY + details.length * rowHeight + 22;
    doc.moveTo(left, footerY).lineTo(right, footerY).lineWidth(1).strokeColor("#e2e8f0").stroke();
    doc.fillColor("#475569").font("Helvetica").fontSize(8)
      .text("Este documento es una constancia de pago aprobado emitida por TURESMA. No reemplaza una factura ni otro comprobante tributario autorizado.", left, footerY + 14, {
        width,
        align: "center",
        lineGap: 3,
      });
    doc.fillColor("#64748b").fontSize(8)
      .text(EMPRESA.email, left, footerY + 54, { width, align: "center" });

    doc.end();
  } catch (error) {
    reject(error);
  }
});

const enviarReciboPago = async (res: any, pago: any) => {
  const buffer = await generarReciboPago(pago);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="recibo_pago_${pago.id}.pdf"`);
  return res.status(200).send(buffer);
};

module.exports = { obtenerPagoAprobado, generarReciboPago, enviarReciboPago };
