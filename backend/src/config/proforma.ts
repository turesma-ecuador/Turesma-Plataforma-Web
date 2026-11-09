export {};

const pool = require("./db");
const PDFDocument = require("pdfkit");
const path = require("path");
const fs = require("fs");

// Ruta del logo de Turesma. Se busca en varias ubicaciones para que funcione
// tanto en desarrollo (ts-node desde /backend) como compilado (node dist/…).
const LOGO_PATH = (() => {
  const candidates = [
    path.join(process.cwd(), "assets", "logo.png"),
    path.join(process.cwd(), "..", "web", "public", "logo.png"),
    path.join(__dirname, "..", "..", "assets", "logo.png"),
    path.join(__dirname, "..", "..", "..", "web", "public", "logo.png"),
    path.join(__dirname, "..", "assets", "logo.png"),
  ];
  for (const p of candidates) { try { if (fs.existsSync(p)) return p; } catch { /* nada */ } }
  return null;
})();

// Datos fijos de la empresa, tal como aparecen en la proforma física de Turesma.
const EMPRESA = {
  lema: "EL TURISMO ES NUESTRA PASION.",
  sub1: "TRASLADO DE PERSONAL A LOS MEJORES RESORT DEL ECUADOR",
  sub2: "VIAJES Y TURISMO A NIVEL NACIONAL",
  nombre: "TURESMA",
  ruc: "1391763581001",
  razon: "TURISMO ESMERALDA S.A. TURESMA",
  direccion: 'La pradera segunda etapa, manzana "Q" villa 14.',
  telefonos: "0993570061, 0990861287",
  email: "turesmasa@hotmail.com",
  banco: { nombre: "BANCO COMERCIAL DE MANABI", tipo: "de ahorros", numero: "304369002", titular: "TURISMO ESMERALDA S.A TURESMA", ruc: "1391763581001" },
  gerente: "Ing. Kevin Delgado M.",
  cargoGerente: "Gerente Propietario",
};

const fmtFecha = (f: any) => {
  if (!f) return "";
  try {
    const isoDate = String(f).match(/^(\d{4})-(\d{2})-(\d{2})/);
    const d = isoDate
      ? new Date(Number(isoDate[1]), Number(isoDate[2]) - 1, Number(isoDate[3]))
      : new Date(f);
    return `${d.getDate()}-${d.getMonth() + 1}-${d.getFullYear()}`;
  }
  catch { return String(f); }
};
const fmtUSD = (n: number) => Number(n || 0).toLocaleString("es-EC", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Devuelve el id de la cotización asociada a una reserva (si existe).
const getCotizacionIdDeReserva = async (reservaId: number, usuarioId?: number): Promise<number | null> => {
  const ownershipFilter = usuarioId === undefined ? "" : "AND usuario_id = $2";
  const params = usuarioId === undefined ? [reservaId] : [reservaId, usuarioId];
  const r = await pool.query(
    `SELECT id FROM cotizaciones WHERE reserva_id = $1 ${ownershipFilter} ORDER BY id DESC LIMIT 1`,
    params
  );
  return r.rowCount ? Number(r.rows[0].id) : null;
};

// Arma los datos de la proforma de una cotización y le asigna número si no tiene
// (continúa la numeración física: 22604 → 22605…).
const buildProformaData = async (cotizacionId: number) => {
  const r = await pool.query(
    `SELECT c.id, c.origen, c.destino, c.fecha_servicio, c.hora_salida,
            c.fecha_regreso, c.hora_regreso, c.num_personas,
            c.notas, c.tipo_vehiculo, c.proforma_numero,
            COALESCE(c.precio_final, c.precio_estimado, 0)::numeric AS precio,
            u.nombre AS cliente_nombre, u.email AS cliente_email,
            u.telefono AS cliente_telefono, u.cedula AS cliente_cedula,
            u.tipo_identificacion AS cliente_tipo_identificacion
     FROM cotizaciones c JOIN usuarios u ON u.id = c.usuario_id
     WHERE c.id = $1 LIMIT 1`,
    [cotizacionId]
  );
  if (r.rowCount === 0) return null;
  const c = r.rows[0];
  if (!c.proforma_numero) {
    const upd = await pool.query(
      `UPDATE cotizaciones SET proforma_numero = (SELECT COALESCE(MAX(proforma_numero), 22604) + 1 FROM cotizaciones)
       WHERE id = $1 AND proforma_numero IS NULL RETURNING proforma_numero`,
      [cotizacionId]
    );
    c.proforma_numero = upd.rows[0]?.proforma_numero
      || (await pool.query("SELECT proforma_numero FROM cotizaciones WHERE id = $1", [cotizacionId])).rows[0]?.proforma_numero;
  }
  return {
    numero: c.proforma_numero,
    fecha: new Date().toISOString().slice(0, 10),
    empresa: EMPRESA,
    cliente: { nombre: c.cliente_nombre, email: c.cliente_email, telefono: c.cliente_telefono, cedula: c.cliente_cedula, tipo_identificacion: c.cliente_tipo_identificacion },
    servicio: {
      origen: c.origen, destino: c.destino, fecha_servicio: c.fecha_servicio, hora_salida: c.hora_salida,
      fecha_regreso: c.fecha_regreso, hora_regreso: c.hora_regreso,
      num_personas: c.num_personas, notas: c.notas, tipo_vehiculo: c.tipo_vehiculo,
    },
    precio: Number(c.precio) || 0,
  };
};

const buildProformaDataDeReserva = async (reservaId: number, usuarioId: number) => {
  const reservationResult = await pool.query(
    `SELECT r.id, rp.id AS requerimiento_id, r.origen, r.destino,
            COALESCE(r.fecha_salida::date, r.fecha_servicio::date, r.fecha_reserva)::text AS fecha_servicio,
            COALESCE(r.hora_salida::text, c.hora_salida) AS hora_salida,
            r.fecha_regreso::text AS fecha_regreso, r.hora_regreso::text AS hora_regreso,
            r.num_personas, r.notas, COALESCE(r.tipo_vehiculo, v.tipo) AS tipo_vehiculo,
            r.total::numeric AS precio,
            u.nombre AS cliente_nombre, u.email AS cliente_email,
            u.telefono AS cliente_telefono, u.cedula AS cliente_cedula,
            u.tipo_identificacion AS cliente_tipo_identificacion
     FROM reservas r
     JOIN usuarios u ON u.id = r.usuario_id
     LEFT JOIN vehiculos v ON v.id = r.vehiculo_id
     LEFT JOIN requerimientos_personalizados rp
       ON rp.reserva_id = r.id AND rp.usuario_id = r.usuario_id
     LEFT JOIN LATERAL (
       SELECT hora_salida FROM cotizaciones
       WHERE reserva_id = r.id AND usuario_id = r.usuario_id
       ORDER BY id DESC LIMIT 1
     ) c ON true
     WHERE r.id = $1 AND r.usuario_id = $2
     LIMIT 1`,
    [reservaId, usuarioId]
  );
  if (!reservationResult.rowCount) return null;
  const reservation = reservationResult.rows[0];
  if (reservation.requerimiento_id) {
    return buildProformaDataRequerimiento(Number(reservation.requerimiento_id), usuarioId);
  }

  const cotizacionId = await getCotizacionIdDeReserva(reservaId, usuarioId);
  if (cotizacionId) {
    const quoteData = await buildProformaData(cotizacionId);
    if (quoteData) {
      const currentReservation = reservation;
      quoteData.precio = Number(currentReservation.precio) || 0;
      quoteData.servicio = {
        ...quoteData.servicio,
        origen: currentReservation.origen,
        destino: currentReservation.destino,
        fecha_servicio: currentReservation.fecha_servicio,
        hora_salida: currentReservation.hora_salida,
        fecha_regreso: currentReservation.fecha_regreso,
        hora_regreso: currentReservation.hora_regreso,
        num_personas: currentReservation.num_personas,
        notas: currentReservation.notas,
        tipo_vehiculo: currentReservation.tipo_vehiculo,
      };
      return quoteData;
    }
  }

  return {
    numero: `RES-${reservation.id}`,
    fecha: new Date().toISOString().slice(0, 10),
    empresa: EMPRESA,
    cliente: {
      nombre: reservation.cliente_nombre,
      email: reservation.cliente_email,
      telefono: reservation.cliente_telefono,
      cedula: reservation.cliente_cedula,
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
    precio: Number(reservation.precio) || 0,
  };
};

const buildProformaDataRequerimiento = async (requerimientoId: number, usuarioId?: number) => {
  const ownershipFilter = usuarioId === undefined ? "" : "AND r.usuario_id = $2";
  const params = usuarioId === undefined ? [requerimientoId] : [requerimientoId, usuarioId];
  const result = await pool.query(
    `SELECT r.id, r.organizacion, r.detalles, r.service_groups, r.precio_final,
            r.estado, u.nombre AS cliente_nombre, u.email AS cliente_email,
            u.telefono AS cliente_telefono, u.cedula AS cliente_cedula,
            u.tipo_identificacion AS cliente_tipo_identificacion
     FROM requerimientos_personalizados r
     JOIN usuarios u ON u.id = r.usuario_id
     WHERE r.id = $1 ${ownershipFilter}
       AND r.estado IN ('propuesta_enviada', 'pago_pendiente', 'pagado')
     LIMIT 1`,
    params
  );
  if (!result.rowCount) return null;

  const request = result.rows[0];
  const groups = Array.isArray(request.service_groups) ? request.service_groups : [];
  const items = groups.map((group: Record<string, unknown>, index: number) => {
    const quantity = Number(group.cantidad_vehiculos) || 1;
    const total = Number(group.precio_total) || 0;
    const details = [
      `Grupo ${index + 1}${group.tipo_vehiculo ? ` · ${group.tipo_vehiculo}` : ""}`,
      `${group.origen || "Salida por definir"} → ${group.destino || "Destino por definir"}`,
      `Fecha: ${fmtFecha(group.fecha_servicio)}${group.fecha_fin ? ` al ${fmtFecha(group.fecha_fin)}` : ""}${group.hora_salida ? ` · ${group.hora_salida}` : ""}`,
      `${quantity} vehículo(s)${group.pasajeros_por_vehiculo ? ` · ${group.pasajeros_por_vehiculo} pasajeros por unidad` : ""}`,
      group.paradas ? `Paradas: ${group.paradas}` : "",
      group.detalles ? `Indicaciones: ${group.detalles}` : "",
    ].filter(Boolean);
    if (index === 0 && request.detalles) details.push(`Requerimiento: ${request.detalles}`);
    return {
      cantidad: quantity,
      descripcion: details.join("\n"),
      precio_unitario: total / quantity,
      total,
    };
  });
  return {
    numero: `REQ-${request.id}`,
    fecha: new Date().toISOString().slice(0, 10),
    empresa: EMPRESA,
    cliente: {
      nombre: request.cliente_nombre,
      email: request.cliente_email,
      telefono: request.cliente_telefono,
      cedula: request.cliente_cedula,
      tipo_identificacion: request.cliente_tipo_identificacion,
    },
    servicio: {
      origen: "Varios grupos de servicio",
      destino: request.organizacion || "Requerimiento personalizado",
      fecha_servicio: null,
      hora_salida: null,
      fecha_regreso: null,
      hora_regreso: null,
      num_personas: null,
      notas: request.detalles,
      tipo_vehiculo: "Varios",
    },
    precio: Number(request.precio_final) || 0,
    proformaItems: items,
  };
};

const generarProformaMultigrupoPDF = (d: any): Promise<Buffer> => new Promise((resolve, reject) => {
  try {
    const doc = new PDFDocument({ size: "A4", margin: 40 });
    const chunks: any[] = [];
    doc.on("data", (chunk: any) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const e = d.empresa;
    const left = 40;
    const right = 555;
    const width = right - left;
    let headerTop = 44;
    if (LOGO_PATH) {
      try {
        const logoW = 180;
        doc.image(LOGO_PATH, left + (width - logoW) / 2, 30, { width: logoW });
        headerTop = 30 + logoW * (720 / 2183) + 10;
      } catch {
        headerTop = 44;
      }
    }

    doc.font("Helvetica-Bold").fontSize(12).text(e.lema, left, headerTop, { width, align: "center" });
    doc.font("Helvetica-Oblique").fontSize(9.5).text(e.sub1, { width, align: "center" });
    doc.text(e.sub2, { width, align: "center" });
    doc.font("Helvetica-Bold").fontSize(10).text(`${e.nombre}   RUC: ${e.ruc}`, { width, align: "center" });
    doc.font("Helvetica").fontSize(9.5).text(`Razón Social: ${e.razon}`, { width, align: "center" });
    doc.text(`Dirección: ${e.direccion}`, { width, align: "center" });
    doc.text(`Teléfono: ${e.telefonos}`, { width, align: "center" });
    doc.fillColor("#e31e24").text(`Email: ${e.email}`, { width, align: "center" }).fillColor("#000000");
    doc.moveDown(1.2);
    const dividerY = doc.y;
    doc.lineWidth(2).strokeColor("#e31e24").moveTo(left, dividerY).lineTo(right, dividerY).stroke();
    doc.strokeColor("#0b0f1a").moveDown(0.8);

    const titleY = doc.y;
    doc.font("Helvetica-Bold").fontSize(11).text(String(d.cliente.nombre || "").toUpperCase(), left, titleY, { width: 300 });
    doc.text(`PROFORMA. ${d.numero}`, 340, titleY, { width: right - 340, align: "right" });
    doc.moveDown(0.6);
    const tipoIdentificacion = d.cliente.tipo_identificacion || (String(d.cliente.cedula || "").length === 13 ? "ruc" : "cedula");
    const etiquetaIdentificacion = tipoIdentificacion === "pasaporte" ? "PASAPORTE" : tipoIdentificacion === "ruc" ? "RUC" : "CÉDULA";
    doc.font("Helvetica").fontSize(10).text(`${etiquetaIdentificacion}:   ${d.cliente.cedula || "—"}`, left);
    doc.text(`FECHA:   ${fmtFecha(d.fecha)}`, left);
    doc.moveDown(0.8);

    const colW = { cant: 52, desc: 273, uni: 95, tot: 95 };
    const cols = {
      cant: left,
      desc: left + colW.cant,
      uni: left + colW.cant + colW.desc,
      tot: left + colW.cant + colW.desc + colW.uni,
    };
    const headH = 26;
    const drawTableHeader = (y: number) => {
      doc.rect(left, y, width, headH).fill("#0b0f1a");
      doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(8);
      doc.text("CANT.", cols.cant, y + 9, { width: colW.cant, align: "center" });
      doc.text("GRUPO / RUTA / SERVICIO", cols.desc, y + 9, { width: colW.desc, align: "center" });
      doc.text("P. UNITARIO", cols.uni, y + 9, { width: colW.uni, align: "center" });
      doc.text("P. TOTAL", cols.tot, y + 9, { width: colW.tot, align: "center" });
    };
    const drawColumnLines = (top: number, bottom: number) => {
      doc.lineWidth(0.7).strokeColor("#cbd5e1");
      doc.moveTo(left, top).lineTo(left, bottom).stroke();
      [cols.desc, cols.uni, cols.tot, right].forEach(x => doc.moveTo(x, top).lineTo(x, bottom).stroke());
    };

    let tableY = doc.y;
    drawTableHeader(tableY);
    tableY += headH;
    for (const item of d.proformaItems) {
      const description = String(item.descripcion || "");
      doc.font("Helvetica").fontSize(9);
      const contentHeight = doc.heightOfString(description, { width: colW.desc - 20, lineGap: 2 });
      const rowH = Math.max(42, contentHeight + 20);
      if (tableY + rowH > 690) {
        doc.addPage();
        tableY = 40;
        drawTableHeader(tableY);
        tableY += headH;
      }
      doc.rect(left, tableY, width, rowH).fill("#ffffff");
      doc.fillColor("#0f172a").font("Helvetica").fontSize(9)
        .text(description, cols.desc + 10, tableY + 10, { width: colW.desc - 20, lineGap: 2 });
      doc.font("Helvetica").fontSize(10)
        .text(String(item.cantidad), cols.cant + 4, tableY + 10, { width: colW.cant - 8, align: "center" })
        .text(fmtUSD(Number(item.precio_unitario)), cols.uni + 8, tableY + 10, { width: colW.uni - 16, align: "right" })
        .text(fmtUSD(Number(item.total)), cols.tot + 8, tableY + 10, { width: colW.tot - 16, align: "right" });
      drawColumnLines(tableY, tableY + rowH);
      doc.moveTo(left, tableY + rowH).lineTo(right, tableY + rowH).stroke();
      tableY += rowH;
    }

    const totH = 28;
    if (tableY + totH + 125 > 750) {
      doc.addPage();
      tableY = 40;
      drawTableHeader(tableY);
      tableY += headH;
    }
    doc.rect(cols.uni, tableY, colW.uni + colW.tot, totH).fill("#f8fafc");
    doc.lineWidth(0.7).strokeColor("#cbd5e1").rect(cols.uni, tableY, colW.uni + colW.tot, totH).stroke();
    doc.moveTo(cols.tot, tableY).lineTo(cols.tot, tableY + totH).stroke();
    doc.fillColor("#0b0f1a").font("Helvetica-Bold").fontSize(9)
      .text("TOTAL USD", cols.uni, tableY + 9, { width: colW.uni, align: "center" });
    doc.fillColor("#e31e24").font("Helvetica-Bold").fontSize(10)
      .text(fmtUSD(d.precio), cols.tot + 8, tableY + 8, { width: colW.tot - 16, align: "right" });

    const footY = tableY + totH + 30;
    doc.fillColor("#000000").font("Helvetica-Bold").fontSize(10).text(e.banco.nombre, left, footY);
    doc.font("Helvetica").fontSize(10);
    doc.font("Helvetica-Bold").text("Cuenta: ", { continued: true }).font("Helvetica").text(e.banco.tipo);
    doc.font("Helvetica-Bold").text("Numero: ", { continued: true }).font("Helvetica").text(e.banco.numero);
    doc.font("Helvetica-Bold").text("Nombre: ", { continued: true }).font("Helvetica").text(e.banco.titular);
    doc.font("Helvetica-Bold").text("RUC: ", { continued: true }).font("Helvetica").text(e.banco.ruc);
    doc.font("Helvetica-Oblique").fontSize(8).fillColor("#64748b")
      .text("Documento informativo: no es factura ni comprobante de pago.", left, footY + 68, { width: 280 });
    const firmaX = 340;
    const firmaW = 215;
    const firmaY = footY + 55;
    doc.moveTo(firmaX, firmaY).lineTo(firmaX + firmaW, firmaY).stroke();
    doc.fillColor("#000000").font("Helvetica-Bold").fontSize(10)
      .text(e.gerente, firmaX, firmaY + 6, { width: firmaW, align: "center" });
    doc.font("Helvetica").fontSize(9.5).text(e.cargoGerente, firmaX, firmaY + 20, { width: firmaW, align: "center" });
    doc.end();
  } catch (error) {
    reject(error);
  }
});

// Genera el PDF de la proforma (Buffer), replicando el formato de la empresa.
const generarProformaPDF = (d: any): Promise<Buffer> => new Promise((resolve, reject) => {
  if (Array.isArray(d.proformaItems)) {
    generarProformaMultigrupoPDF(d).then(resolve, reject);
    return;
  }
  try {
    const doc = new PDFDocument({ size: "A4", margin: 40 });
    const chunks: any[] = [];
    doc.on("data", (c: any) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));

    const e = d.empresa;
    const left = 40;
    const right = 555;
    const width = right - left;

    // ── Logo (centrado, tipo membrete) ──
    let headerTop = 44;
    if (LOGO_PATH) {
      try {
        const logoW = 180;
        doc.image(LOGO_PATH, left + (width - logoW) / 2, 30, { width: logoW });
        headerTop = 30 + logoW * (720 / 2183) + 10; // alto proporcional del logo + aire
      } catch { /* si el logo falla, seguimos con solo texto */ }
    }

    // ── Membrete (centrado) ──
    doc.font("Helvetica-Bold").fontSize(12).text(e.lema, left, headerTop, { width, align: "center" });
    doc.font("Helvetica-Oblique").fontSize(9.5);
    doc.text(e.sub1, { width, align: "center" });
    doc.text(e.sub2, { width, align: "center" });
    doc.font("Helvetica-Bold").fontSize(10).text(`${e.nombre}   RUC: ${e.ruc}`, { width, align: "center" });
    doc.font("Helvetica").fontSize(9.5);
    doc.text(`Razón Social: ${e.razon}`, { width, align: "center" });
    doc.text(`Dirección: ${e.direccion}`, { width, align: "center" });
    doc.text(`Teléfono: ${e.telefonos}`, { width, align: "center" });
    doc.fillColor("#e31e24").text(`Email: ${e.email}`, { width, align: "center" });
    doc.fillColor("#000000");

    doc.moveDown(1.2);
    const dividerY = doc.y;
    doc.lineWidth(2).strokeColor("#e31e24").moveTo(left, dividerY).lineTo(right, dividerY).stroke();
    doc.strokeColor("#0b0f1a");
    doc.moveDown(0.8);

    // ── Cliente + N° de proforma ──
    let y = doc.y;
    doc.font("Helvetica-Bold").fontSize(11).text(String(d.cliente.nombre || "").toUpperCase(), left, y, { width: 360 });
    doc.font("Helvetica-Bold").fontSize(11).text(`PROFORMA. ${d.numero}`, 360, y, { width: width - 320, align: "right" });
    doc.moveDown(0.6);
    const tipoIdentificacion = d.cliente.tipo_identificacion || (String(d.cliente.cedula || "").length === 13 ? "ruc" : "cedula");
    const etiquetaIdentificacion = tipoIdentificacion === "pasaporte" ? "PASAPORTE" : tipoIdentificacion === "ruc" ? "RUC" : "CÉDULA";
    doc.font("Helvetica").fontSize(10);
    doc.text(`${etiquetaIdentificacion}:   ${d.cliente.cedula || "—"}`, left);
    doc.text(`FECHA:   ${fmtFecha(d.fecha)}`, left);
    doc.moveDown(0.8);

    // ── Tabla ──
    const colW = { cant: 58, desc: 267, uni: 95, tot: 95 };
    const cols = {
      cant: left,
      desc: left + colW.cant,
      uni: left + colW.cant + colW.desc,
      tot: left + colW.cant + colW.desc + colW.uni,
    };
    const headY = doc.y;
    const headH = 26;
    const rowY = headY + headH;
    const cellPadding = 10;
    const labelWidth = 94;
    const valueX = cols.desc + cellPadding + labelWidth;
    const valueWidth = colW.desc - cellPadding * 2 - labelWidth;
    const detailRows = [
      { label: "Punto de salida", value: d.servicio.origen },
      { label: "Destino", value: d.servicio.destino },
      {
        label: "Fecha y hora salida",
        value: `${fmtFecha(d.servicio.fecha_servicio)}${d.servicio.hora_salida ? ` · ${d.servicio.hora_salida}` : ""}`,
      },
      { label: "Pasajeros", value: `${d.servicio.num_personas} pasajero(s)` },
      ...(d.servicio.fecha_regreso ? [{
        label: "Recogida de regreso",
        value: d.servicio.destino,
      }, {
        label: "Fecha y hora regreso",
        value: `${fmtFecha(d.servicio.fecha_regreso)}${d.servicio.hora_regreso ? ` · ${d.servicio.hora_regreso}` : ""}`,
      }, {
        label: "Destino regreso",
        value: d.servicio.origen,
      }] : []),
      ...(d.servicio.tipo_vehiculo ? [{ label: "Categoría", value: String(d.servicio.tipo_vehiculo) }] : []),
    ];
    const notes = String(d.servicio.notas || "Servicio de transporte para traslado de personal.");
    const detailHeights = detailRows.map(({ value }) => doc.heightOfString(value, {
      width: valueWidth,
      font: "Helvetica",
      fontSize: 9,
      lineGap: 2,
    }));
    const notesHeight = doc.heightOfString(notes, {
      width: colW.desc - cellPadding * 2,
      font: "Helvetica",
      fontSize: 9,
      lineGap: 2,
    });
    const titleHeight = 14;
    const rowGaps = 5;
    const contentHeight = titleHeight + detailHeights.reduce((total, height) => total + height, 0)
      + rowGaps * (detailRows.length + 1) + notesHeight;
    const rowH = Math.max(82, contentHeight + cellPadding * 2);

    doc.rect(left, headY, width, headH).fill("#0b0f1a");
    doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(8);
    doc.text("CANT.", cols.cant, headY + 9, { width: colW.cant, align: "center" });
    doc.text("DESCRIPCIÓN DEL SERVICIO", cols.desc, headY + 9, { width: colW.desc, align: "center" });
    doc.text("P. UNITARIO", cols.uni, headY + 9, { width: colW.uni, align: "center" });
    doc.text("P. TOTAL", cols.tot, headY + 9, { width: colW.tot, align: "center" });

    doc.rect(left, rowY, width, rowH).fill("#ffffff");
    doc.fillColor("#0f172a").font("Helvetica-Bold").fontSize(9);
    doc.text("1", cols.cant, rowY + cellPadding, { width: colW.cant, align: "center" });
    doc.text("Servicio de transporte", cols.desc + cellPadding, rowY + cellPadding, {
      width: colW.desc - cellPadding * 2,
      lineBreak: false,
    });

    let detailY = rowY + cellPadding + titleHeight + 4;
    detailRows.forEach(({ label, value }, index) => {
      doc.fillColor("#475569").font("Helvetica-Bold").fontSize(8.5)
        .text(`${label}:`, cols.desc + cellPadding, detailY, { width: labelWidth - 4, lineBreak: false });
      doc.fillColor("#334155").font("Helvetica").fontSize(9)
        .text(value, valueX, detailY, { width: valueWidth, lineGap: 2 });
      detailY += detailHeights[index] + rowGaps;
    });
    doc.fillColor("#334155").font("Helvetica").fontSize(9)
      .text(notes, cols.desc + cellPadding, detailY, { width: colW.desc - cellPadding * 2, lineGap: 2 });

    doc.fillColor("#0f172a").font("Helvetica").fontSize(10)
      .text(fmtUSD(d.precio), cols.uni + 8, rowY + cellPadding, { width: colW.uni - 16, align: "right" })
      .text(fmtUSD(d.precio), cols.tot + 8, rowY + cellPadding, { width: colW.tot - 16, align: "right" });

    const rowBottom = rowY + rowH;
    doc.lineWidth(0.7).strokeColor("#cbd5e1");
    doc.rect(left, headY, width, headH + rowH).stroke();
    [cols.desc, cols.uni, cols.tot].forEach((x) => doc.moveTo(x, headY).lineTo(x, rowBottom).stroke());
    doc.moveTo(left, rowY).lineTo(right, rowY).stroke();

    const totY = rowBottom;
    const totH = 28;
    doc.rect(cols.uni, totY, colW.uni + colW.tot, totH).fill("#f8fafc");
    doc.lineWidth(0.7).strokeColor("#cbd5e1")
      .rect(cols.uni, totY, colW.uni + colW.tot, totH).stroke();
    doc.moveTo(cols.tot, totY).lineTo(cols.tot, totY + totH).stroke();
    doc.fillColor("#0b0f1a").font("Helvetica-Bold").fontSize(9)
      .text("TOTAL USD", cols.uni, totY + 9, { width: colW.uni, align: "center" });
    doc.fillColor("#e31e24").font("Helvetica-Bold").fontSize(10)
      .text(fmtUSD(d.precio), cols.tot + 8, totY + 8, { width: colW.tot - 16, align: "right" });
    doc.fillColor("#000000");

    // ── Banco + firma ──
    const footY = totY + totH + 30;
    doc.font("Helvetica-Bold").fontSize(10).text(e.banco.nombre, left, footY);
    doc.font("Helvetica").fontSize(10);
    doc.font("Helvetica-Bold").text("Cuenta: ", { continued: true }).font("Helvetica").text(e.banco.tipo);
    doc.font("Helvetica-Bold").text("Numero: ", { continued: true }).font("Helvetica").text(e.banco.numero);
    doc.font("Helvetica-Bold").text("Nombre: ", { continued: true }).font("Helvetica").text(e.banco.titular);
    doc.font("Helvetica-Bold").text("RUC: ", { continued: true }).font("Helvetica").text(e.banco.ruc);
    doc.font("Helvetica-Oblique").fontSize(8).fillColor("#64748b")
      .text("Documento informativo: no es factura ni comprobante de pago.", left, footY + 68, { width: 280 });
    doc.fillColor("#000000");

    // Firma (derecha)
    const firmaX = 340, firmaW = 215;
    const firmaY = footY + 55;
    doc.moveTo(firmaX, firmaY).lineTo(firmaX + firmaW, firmaY).stroke();
    doc.font("Helvetica-Bold").fontSize(10).text(e.gerente, firmaX, firmaY + 6, { width: firmaW, align: "center" });
    doc.font("Helvetica").fontSize(9.5).text(e.cargoGerente, firmaX, doc.y, { width: firmaW, align: "center" });

    doc.end();
  } catch (err) {
    reject(err);
  }
});

module.exports = {
  EMPRESA,
  buildProformaData,
  buildProformaDataDeReserva,
  buildProformaDataRequerimiento,
  generarProformaPDF,
  getCotizacionIdDeReserva,
};
