export {};

const pool = require("./db");
const PDFDocument = require("pdfkit");
const { EMPRESA, LOGO_PATH } = require("./proforma");

const fmtUSD = (value: unknown) =>
  `$${Number(value || 0).toLocaleString("es-EC", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fmtFecha = (value: unknown) => {
  if (!value) return "—";
  const raw = String(value);
  const dateOnly = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const date = dateOnly
    ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]))
    : new Date(raw);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("es-EC", {
    dateStyle: "long",
    timeZone: "America/Guayaquil",
  }).format(date);
};

const buildOrdenCompraDataDeReserva = async (reservaId: number, usuarioId?: number) => {
  const ownershipFilter = usuarioId === undefined ? "" : "AND r.usuario_id = $2";
  const params = usuarioId === undefined ? [reservaId] : [reservaId, usuarioId];
  const reservationResult = await pool.query(
    `SELECT r.id, r.usuario_id, r.estado_pago, r.monto_pagado,
            COALESCE(r.fecha_salida::date, r.fecha_servicio::date, r.fecha_reserva)::text AS fecha_servicio,
            COALESCE(r.hora_salida::text, c.hora_salida) AS hora_salida,
            r.fecha_regreso::text AS fecha_regreso, r.hora_regreso::text AS hora_regreso,
            r.num_personas, r.notas, COALESCE(r.tipo_vehiculo, v.tipo) AS tipo_vehiculo,
            r.origen, r.destino, r.total::numeric AS total,
            u.nombre AS cliente_nombre, u.email AS cliente_email,
            u.telefono AS cliente_telefono, u.cedula AS cliente_identificacion,
            u.tipo_identificacion AS cliente_tipo_identificacion
     FROM reservas r
     JOIN usuarios u ON u.id = r.usuario_id
     LEFT JOIN vehiculos v ON v.id = r.vehiculo_id
     LEFT JOIN LATERAL (
       SELECT hora_salida FROM cotizaciones
       WHERE reserva_id = r.id AND usuario_id = r.usuario_id
       ORDER BY id DESC LIMIT 1
     ) c ON true
     WHERE r.id = $1 ${ownershipFilter}
     LIMIT 1`,
    params
  );
  if (!reservationResult.rowCount) return null;

  const reservation = reservationResult.rows[0];
  const paymentResult = await pool.query(
    `SELECT MAX(COALESCE(revisado_en, creado_en)) AS fecha_pago,
            COALESCE(STRING_AGG(DISTINCT REPLACE(metodo, '_', ' '), ', '), '—') AS metodo_pago
     FROM pagos_reserva
     WHERE reserva_id = $1 AND estado = 'aprobado'`,
    [reservaId]
  );

  return {
    numero: `OC-RES-${String(reservation.id).padStart(6, "0")}`,
    fecha: paymentResult.rows[0]?.fecha_pago || new Date(),
    empresa: EMPRESA,
    cliente: {
      nombre: reservation.cliente_nombre,
      email: reservation.cliente_email,
      telefono: reservation.cliente_telefono,
      identificacion: reservation.cliente_identificacion,
      tipo_identificacion: reservation.cliente_tipo_identificacion,
    },
    servicio: {
      origen: reservation.origen,
      destino: reservation.destino,
      fecha_servicio: reservation.fecha_servicio,
      hora_salida: reservation.hora_salida,
      fecha_regreso: reservation.fecha_regreso,
      hora_regreso: reservation.hora_regreso,
      num_personas: reservation.num_personas,
      notas: reservation.notas,
      tipo_vehiculo: reservation.tipo_vehiculo,
    },
    total: Number(reservation.total) || 0,
    monto_pagado: Number(reservation.monto_pagado) || 0,
    estado_pago: reservation.estado_pago,
    metodo_pago: paymentResult.rows[0]?.metodo_pago || "—",
  };
};

const generarOrdenCompraPDF = (data: any): Promise<Buffer> => new Promise((resolve, reject) => {
  try {
    if (!LOGO_PATH) throw new Error("No se encontró el logo de TURESMA para generar la orden de compra");

    const doc = new PDFDocument({ size: "A4", margin: 42 });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const left = 42;
    const right = 553;
    const width = right - left;
    const logoWidth = 160;
    doc.image(LOGO_PATH, left + (width - logoWidth) / 2, 26, { width: logoWidth });
    doc.y = 26 + logoWidth * (720 / 2183) + 10;

    const empresa = data.empresa;
    doc.fillColor("#0b0f1a").font("Helvetica-Bold").fontSize(11)
      .text(empresa.lema, left, doc.y, { width, align: "center" });
    doc.font("Helvetica").fontSize(8.5)
      .text(empresa.sub1, { width, align: "center" })
      .text(empresa.sub2, { width, align: "center" })
      .text(`${empresa.nombre} · RUC ${empresa.ruc}`, { width, align: "center" })
      .text(`Razón social: ${empresa.razon}`, { width, align: "center" })
      .text(`Dirección: ${empresa.direccion}`, { width, align: "center" })
      .text(`Teléfono: ${empresa.telefonos} · ${empresa.email}`, { width, align: "center" });

    doc.moveDown(0.8);
    const dividerY = doc.y;
    doc.lineWidth(2).strokeColor("#e31e24").moveTo(left, dividerY).lineTo(right, dividerY).stroke();
    doc.moveDown(0.8);
    doc.fillColor("#0b0f1a").font("Helvetica-Bold").fontSize(19)
      .text("ORDEN DE COMPRA", left, doc.y, { width, align: "center" });
    doc.moveDown(0.25);
    doc.fontSize(10).text(`${data.numero} · ${fmtFecha(data.fecha)}`, { width, align: "center" });
    doc.moveDown(1);

    const drawSectionTitle = (title: string, minimumRows: number) => {
      if (doc.y + 26 + minimumRows * 26 > doc.page.height - 42) doc.addPage();
      doc.rect(left, doc.y, width, 20).fill("#0b0f1a");
      doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(9)
        .text(title, left + 10, doc.y + 5, { width: width - 20 });
      doc.y += 26;
    };

    const drawRows = (rows: Array<[string, unknown]>) => {
      rows.forEach(([label, rawValue], index) => {
        const value = String(rawValue || "—").slice(0, 1000);
        const labelWidth = 145;
        const valueWidth = width - labelWidth - 24;
        const labelHeight = doc.heightOfString(label, { width: labelWidth, font: "Helvetica", fontSize: 9 });
        const valueHeight = doc.heightOfString(value, { width: valueWidth, font: "Helvetica-Bold", fontSize: 9 });
        const rowHeight = Math.max(20, labelHeight, valueHeight) + 6;
        if (doc.y + rowHeight > doc.page.height - 42) doc.addPage();

        const y = doc.y;
        if (index % 2 === 0) doc.rect(left, y, width, rowHeight).fill("#f8fafc");
        doc.fillColor("#64748b").font("Helvetica").fontSize(9)
          .text(label, left + 10, y + 7, { width: labelWidth });
        doc.fillColor("#0f172a").font("Helvetica-Bold").fontSize(9)
          .text(value, left + labelWidth + 18, y + 7, { width: valueWidth });
        doc.y = y + rowHeight;
      });
      doc.moveDown(0.35);
    };

    const tipoIdentificacion = data.cliente.tipo_identificacion
      || (String(data.cliente.identificacion || "").length === 13 ? "ruc" : "cedula");
    const etiquetaIdentificacion = tipoIdentificacion === "pasaporte"
      ? "Pasaporte"
      : tipoIdentificacion === "ruc" ? "RUC" : "Cédula";

    drawSectionTitle("DATOS DEL CLIENTE", 4);
    drawRows([
      ["Cliente", data.cliente.nombre],
      [etiquetaIdentificacion, data.cliente.identificacion],
      ["Correo", data.cliente.email],
      ["Teléfono", data.cliente.telefono],
    ]);

    drawSectionTitle(
      "DETALLE DEL SERVICIO",
      5 + (data.servicio.fecha_regreso ? 1 : 0) + (data.servicio.notas ? 1 : 0)
    );
    drawRows([
      ["Origen", data.servicio.origen],
      ["Destino", data.servicio.destino],
      ["Fecha y hora de salida", `${fmtFecha(data.servicio.fecha_servicio)}${data.servicio.hora_salida ? ` · ${data.servicio.hora_salida}` : ""}`],
      ...(data.servicio.fecha_regreso ? [
        ["Fecha y hora de regreso", `${fmtFecha(data.servicio.fecha_regreso)}${data.servicio.hora_regreso ? ` · ${data.servicio.hora_regreso}` : ""}`] as [string, unknown],
      ] : []),
      ["Pasajeros", data.servicio.num_personas ? `${data.servicio.num_personas}` : "—"],
      ["Tipo de vehículo", data.servicio.tipo_vehiculo],
      ...(data.servicio.notas ? [["Observaciones", data.servicio.notas] as [string, unknown]] : []),
    ]);

    drawSectionTitle("VALORES Y PAGO", 5);
    drawRows([
      ["Valor total de la orden", fmtUSD(data.total)],
      ["Total pagado y validado", fmtUSD(data.monto_pagado)],
      ["Saldo pendiente", fmtUSD(Math.max(0, data.total - data.monto_pagado))],
      ["Método(s) de pago", data.metodo_pago],
      ["Estado", "PAGO VALIDADO"],
    ]);

    doc.fillColor("#475569").font("Helvetica").fontSize(8)
      .text("Documento comercial emitido por TURESMA como respaldo de la orden y del pago validado. No constituye una factura ni un comprobante tributario; la factura correspondiente se emitirá por separado.", left, doc.y + 4, {
        width,
        align: "center",
        lineGap: 3,
      });
    doc.end();
  } catch (error) {
    reject(error);
  }
});

module.exports = { buildOrdenCompraDataDeReserva, generarOrdenCompraPDF };
