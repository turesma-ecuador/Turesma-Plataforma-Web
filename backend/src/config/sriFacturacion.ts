export {};

const fs = require("fs");
const path = require("path");
const https = require("https");
const forge = require("node-forge");
const { create } = require("xmlbuilder2");
const { signXml: signXadesXml } = require("osodreamer-sri-xml-signer");
const PDFDocument = require("pdfkit");
const pool = require("./db");
const { enviarCorreo } = require("./mailer");
const { getUploadsRoot, resolveStoredUploadPath } = require("./storage");

const SRI_NAMESPACES = {
  ds: "http://www.w3.org/2000/09/xmldsig#",
};

const sriConfig = () => {
  const environment = String(process.env.SRI_ENVIRONMENT || "pruebas").toLowerCase();
  return {
    environment,
    ruc: String(process.env.SRI_RUC || ""),
    razonSocial: String(process.env.SRI_RAZON_SOCIAL || "TURISMO ESMERALDA S.A. TURESMA"),
    nombreComercial: String(process.env.SRI_NOMBRE_COMERCIAL || "TURESMA S.A."),
    direccionMatriz: String(process.env.SRI_DIRECCION_MATRIZ || "PRINCIPAL 14"),
    establecimiento: String(process.env.SRI_ESTABLECIMIENTO || "001").padStart(3, "0"),
    puntoEmision: String(process.env.SRI_PUNTO_EMISION || "001").padStart(3, "0"),
    secuencial: String(process.env.SRI_SECUENCIAL || "1").replace(/\D/g, "").slice(-9).padStart(9, "0"),
    certificatePath: String(process.env.SRI_CERTIFICATE_PATH || ""),
    certificatePassword: String(process.env.SRI_CERTIFICATE_PASSWORD || ""),
  };
};

const escapeXml = (value: unknown) => String(value ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&apos;");

const amount = (value: unknown) => Number(value || 0).toFixed(2);
const dateSRI = (value = new Date()) => {
  const date = new Date(value);
  return `${String(date.getDate()).padStart(2, "0")}${String(date.getMonth() + 1).padStart(2, "0")}${date.getFullYear()}`;
};
const dateInvoice = (value: unknown) => {
  const date = new Date(value as string | number | Date);
  return `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}/${date.getFullYear()}`;
};

const modulo11 = (value: string) => {
  let factor = 2;
  let sum = 0;
  for (let index = value.length - 1; index >= 0; index -= 1) {
    sum += Number(value[index]) * factor;
    factor = factor === 7 ? 2 : factor + 1;
  }
  const remainder = 11 - (sum % 11);
  return remainder === 11 ? "0" : remainder === 10 ? "1" : String(remainder);
};

const claveAcceso = (fecha: Date, config: ReturnType<typeof sriConfig>, secuencial: string) => {
  const base = `${dateSRI(fecha)}01${config.ruc}${config.environment === "produccion" ? "2" : "1"}${config.establecimiento}${config.puntoEmision}${secuencial}12345678`;
  return `${base}1${modulo11(base + "1")}`;
};

const readCertificate = () => {
  const config = sriConfig();
  if (!config.certificatePath || !config.certificatePassword) {
    throw new Error("Falta configurar SRI_CERTIFICATE_PATH y SRI_CERTIFICATE_PASSWORD");
  }
  const certificatePath = path.isAbsolute(config.certificatePath)
    ? config.certificatePath
    : [
      path.resolve(process.cwd(), config.certificatePath),
      path.resolve(__dirname, "../..", config.certificatePath),
    ].find((candidate) => fs.existsSync(candidate));
  if (!certificatePath) throw new Error(`No se encontró el certificado SRI configurado: ${config.certificatePath}`);
  if (!fs.existsSync(certificatePath)) throw new Error(`No se encontró el certificado SRI en ${certificatePath}`);
  const binary = fs.readFileSync(certificatePath);
  const asn1 = forge.asn1.fromDer(forge.util.createBuffer(binary.toString("binary")), {
    strict: false,
    parseAllBytes: false,
  });
  const p12 = forge.pkcs12.pkcs12FromAsn1(asn1, false, config.certificatePassword);
  const keyBags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] || [];
  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] || [];
  if (!keyBags[0]?.key || !certBags[0]?.cert) throw new Error("El certificado SRI no contiene una clave privada y certificado válidos");
  return {
    privateKey: forge.pki.privateKeyToPem(keyBags[0].key),
    certificate: forge.pki.certificateToPem(certBags[0].cert),
  };
};

const normalizePkcs12Buffer = (buffer: Buffer) => {
  if (buffer[0] !== 0x30) return buffer;
  let length = buffer[1];
  let headerLength = 2;
  if ((length & 0x80) !== 0) {
    const lengthBytes = length & 0x7f;
    length = 0;
    for (let index = 0; index < lengthBytes; index += 1) length = (length * 256) + buffer[2 + index];
    headerLength += lengthBytes;
  }
  const totalLength = headerLength + length;
  return totalLength < buffer.length ? buffer.subarray(0, totalLength) : buffer;
};

const signXml = async (xml: string) => {
  const config = sriConfig();
  const certificatePath = path.isAbsolute(config.certificatePath)
    ? config.certificatePath
    : [
      path.resolve(process.cwd(), config.certificatePath),
      path.resolve(__dirname, "../..", config.certificatePath),
    ].find((candidate) => fs.existsSync(candidate));
  if (!certificatePath) throw new Error(`No se encontró el certificado SRI configurado: ${config.certificatePath}`);
  const result = await signXadesXml({
    p12Buffer: normalizePkcs12Buffer(fs.readFileSync(certificatePath)),
    password: config.certificatePassword,
    xmlBuffer: Buffer.from(xml, "utf8"),
  });
  return result;
};

const buildInvoiceXml = (invoice: any, config = sriConfig()) => {
  const customerId = invoice.cliente_cedula || invoice.cliente_ruc || "9999999999999";
  const total = Number(invoice.total);
  const root = create({ version: "1.0", encoding: "UTF-8" })
    .ele("factura", { id: "comprobante", version: "1.1.0" })
    .ele("infoTributaria")
    .ele("ambiente").txt(config.environment === "produccion" ? "2" : "1").up()
    .ele("tipoEmision").txt("1").up()
    .ele("razonSocial").txt(config.razonSocial).up()
    .ele("nombreComercial").txt(config.nombreComercial).up()
    .ele("ruc").txt(config.ruc).up()
    .ele("claveAcceso").txt(invoice.clave_acceso).up()
    .ele("codDoc").txt("01").up()
    .ele("estab").txt(config.establecimiento).up()
    .ele("ptoEmi").txt(config.puntoEmision).up()
    .ele("secuencial").txt(invoice.secuencial).up()
    .ele("dirMatriz").txt(config.direccionMatriz).up().up()
    .ele("infoFactura")
    .ele("fechaEmision").txt(dateInvoice(invoice.fecha_emision)).up()
    .ele("dirEstablecimiento").txt(config.direccionMatriz).up()
    .ele("obligadoContabilidad").txt("SI").up()
    .ele("tipoIdentificacionComprador").txt(customerId.length === 13 ? "04" : "05").up()
    .ele("razonSocialComprador").txt(invoice.cliente_nombre).up()
    .ele("identificacionComprador").txt(customerId).up()
    .ele("totalSinImpuestos").txt(amount(total)).up()
    .ele("totalDescuento").txt("0.00").up()
    .ele("totalConImpuestos")
      .ele("totalImpuesto")
      .ele("codigo").txt("2").up()
      .ele("codigoPorcentaje").txt("0").up()
      .ele("baseImponible").txt(amount(total)).up()
      .ele("valor").txt("0.00").up().up().up()
    .ele("propina").txt("0.00").up()
    .ele("importeTotal").txt(amount(total)).up()
    .ele("moneda").txt("DOLAR").up()
    .ele("pagos").ele("pago").ele("formaPago").txt("20").up().ele("total").txt(amount(total)).up().up().up()
    .up()
    .ele("detalles")
      .ele("detalle")
      .ele("codigoPrincipal").txt("001").up()
      .ele("codigoAuxiliar").txt("H492001").up()
      .ele("descripcion").txt(`Servicio de transporte turístico: ${invoice.origen || ""} - ${invoice.destino || ""} | Placa: ${invoice.vehiculo_placa || "POR ASIGNAR"}`).up()
      .ele("cantidad").txt("1.00").up()
      .ele("precioUnitario").txt(amount(total)).up()
      .ele("descuento").txt("0.00").up()
      .ele("precioTotalSinImpuesto").txt(amount(total)).up()
      .ele("impuestos")
        .ele("impuesto")
        .ele("codigo").txt("2").up()
        .ele("codigoPorcentaje").txt("0").up()
        .ele("tarifa").txt("0").up()
        .ele("baseImponible").txt(amount(total)).up()
        .ele("valor").txt("0.00").up()
        .up().up()
      .up().up()
    .up();
  const xml = root.end({ prettyPrint: false });
  const infoAdicional = `<infoAdicional><campoAdicional nombre="Email">${escapeXml(invoice.cliente_email || "")}</campoAdicional><campoAdicional nombre="Reserva">#${invoice.reserva_id}</campoAdicional><campoAdicional nombre="Placa">${escapeXml(invoice.vehiculo_placa || "POR ASIGNAR")}</campoAdicional></infoAdicional>`;
  return xml.replace("</factura>", `${infoAdicional}</factura>`);
};

const sriRequest = (url: string, action: string, body: string): Promise<string> => new Promise((resolve, reject) => {
  const isAuthorization = action === "autorizacionComprobante";
  const namespace = isAuthorization ? "http://ec.gob.sri.ws.autorizacion" : "http://ec.gob.sri.ws.recepcion";
  const parameter = isAuthorization
    ? `<claveAccesoComprobante>${escapeXml(body)}</claveAccesoComprobante>`
    : `<xml>${Buffer.from(body).toString("base64")}</xml>`;
  const payload = `<?xml version="1.0" encoding="UTF-8"?>` +
    `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ec="${namespace}"><soapenv:Body><ec:${action}>${parameter}</ec:${action}></soapenv:Body></soapenv:Envelope>`;
  const request = https.request(url, {
    method: "POST",
    headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: `""`, "Content-Length": Buffer.byteLength(payload) },
    timeout: 30000,
  }, (response: any) => {
    const chunks: Buffer[] = [];
    response.on("data", (chunk: Buffer) => chunks.push(chunk));
    response.on("end", () => {
      const result = Buffer.concat(chunks).toString("utf8");
      if (response.statusCode && response.statusCode >= 400) {
        const detail = result.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 500);
        return reject(new Error(`SRI respondió HTTP ${response.statusCode}${detail ? `: ${detail}` : ""}`));
      }
      resolve(result);
    });
  });
  request.on("timeout", () => request.destroy(new Error("Tiempo de espera agotado al comunicarse con el SRI")));
  request.on("error", reject);
  request.write(payload);
  request.end();
});

const sriUrls = (environment: string) => environment === "produccion"
  ? {
    reception: "https://cel.sri.gob.ec/comprobantes-electronicos-ws/RecepcionComprobantesOffline",
    authorization: "https://cel.sri.gob.ec/comprobantes-electronicos-ws/AutorizacionComprobantesOffline",
  }
  : {
    reception: "https://celcer.sri.gob.ec/comprobantes-electronicos-ws/RecepcionComprobantesOffline",
    authorization: "https://celcer.sri.gob.ec/comprobantes-electronicos-ws/AutorizacionComprobantesOffline",
  };

const responseStatus = (xml: string) => {
  const match = xml.match(/<estado>([^<]+)<\/estado>/i);
  return match?.[1]?.trim().toUpperCase() || "DESCONOCIDO";
};

const xmlText = (value: string) => value
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
  .replace(/<[^>]+>/g, " ")
  .replace(/\s+/g, " ")
  .trim();

const extractMessages = (xml: string) => [...xml.matchAll(/<mensaje>([\s\S]*?)<\/mensaje>/gi)]
  .map((match) => xmlText(match[1]))
  .filter(Boolean)
  .join(" | ");

const extractSRIError = (xml: string) => {
  const messages = extractMessages(xml);
  if (messages) return messages;
  const identifiers = [...xml.matchAll(/<identificador>([^<]*)<\/identificador>/gi)].map((match) => match[1].trim());
  const details = [...xml.matchAll(/<informacionAdicional>([^<]*)<\/informacionAdicional>/gi)].map((match) => match[1].trim());
  return [...identifiers, ...details].filter(Boolean).join(" | ");
};

const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const authorizeWithRetry = async (url: string, accessKey: string) => {
  let lastResponse = "";
  for (let attempt = 0; attempt < 5; attempt += 1) {
    lastResponse = await sriRequest(url, "autorizacionComprobante", accessKey);
    const state = responseStatus(lastResponse);
    if (state === "AUTORIZADO") return lastResponse;
    const comprobantes = Number(lastResponse.match(/<numeroComprobantes>(\d+)<\/numeroComprobantes>/i)?.[1] || 0);
    if (state === "NO AUTORIZADO" && (comprobantes > 0 || extractSRIError(lastResponse))) return lastResponse;
    if (attempt < 4) await wait(1500);
  }
  return lastResponse;
};

const generatePdf = (invoice: any, config: ReturnType<typeof sriConfig>) => new Promise<Buffer>((resolve, reject) => {
  const doc = new PDFDocument({ size: "A4", margin: 18 });
  const chunks: Buffer[] = [];
  const pageWidth = 559;
  const border = "#202020";
  const light = "#f4f4f4";
  const box = (x: number, y: number, width: number, height: number) => doc.rect(x, y, width, height).stroke(border);
  const cell = (text: string, x: number, y: number, width: number, height: number, options: any = {}) => {
    if (options.fill) doc.fillColor(options.fill).rect(x, y, width, height).fill();
    doc.fillColor("#111").font(options.bold ? "Helvetica-Bold" : "Helvetica").fontSize(options.size || 6.5)
      .text(text, x + (options.padding || 3), y + (options.top || 3), {
        width: width - ((options.padding || 3) * 2),
        height: height - 4,
        align: options.align || "left",
        lineBreak: false,
      });
    box(x, y, width, height);
  };
  const customerId = invoice.cliente_cedula || invoice.cliente_ruc || "9999999999999";
  const customerName = invoice.cliente_nombre || "CONSUMIDOR FINAL";
  const vehiclePlate = invoice.vehiculo_placa || "POR ASIGNAR";
  const description = `Servicio de transporte turístico: ${invoice.origen || "—"} - ${invoice.destino || "—"}`;
  const total = amount(invoice.total);
  const invoiceNumber = `${config.establecimiento}-${config.puntoEmision}-${invoice.secuencial}`;
  const drawBarcode = (value: string, x: number, y: number, width: number, height: number) => {
    let cursor = x;
    const pattern = `101${value.split("").map((character) => {
      const code = character.charCodeAt(0);
      return `${(code % 7) + 1}${(code % 5) + 1}${(code % 3) + 1}`;
    }).join("")}101`;
    const unit = width / pattern.split("").reduce((sum, item) => sum + Number(item), 0);
    pattern.split("").forEach((item, index) => {
      const barWidth = Number(item) * unit;
      if (index % 2 === 0) doc.rect(cursor, y, barWidth, height).fill("#111");
      cursor += barWidth;
    });
  };
  const logoPath = [
    path.resolve(process.cwd(), "assets", "logo.png"),
    path.resolve(__dirname, "../../assets/logo.png"),
  ].find((candidate) => fs.existsSync(candidate));

  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  doc.on("end", () => resolve(Buffer.concat(chunks)));
  doc.on("error", reject);

  if (logoPath) doc.image(logoPath, 38, 22, { fit: [235, 145], align: "center", valign: "center" });
  else {
    doc.fillColor("#111").font("Helvetica-Bold").fontSize(20).text("TURESMA S.A.", 18, 70, { width: 265, align: "center" });
    doc.font("Helvetica").fontSize(7).text(config.razonSocial, 18, 95, { width: 265, align: "center" });
  }
  doc.roundedRect(291, 18, 286, 174, 14).stroke(border);
  doc.font("Helvetica").fontSize(8).fillColor("#111").text(`R.U.C.: ${config.ruc}`, 301, 34);
  doc.fillColor("#fff").rect(300, 53, 268, 35).fill("#3aaeca");
  doc.fillColor("#fff").font("Helvetica-Bold").fontSize(20).text("FACTURA", 300, 61, { width: 268, align: "center" });
  doc.fillColor("#111").font("Helvetica").fontSize(7).text(`No. ${invoiceNumber}`, 301, 101);
  doc.text("NÚMERO DE AUTORIZACIÓN", 301, 126);
  doc.fontSize(6.5).text(invoice.clave_acceso || "Pendiente", 301, 143, { width: 266 });
  doc.text(`AMBIENTE: ${config.environment === "produccion" ? "PRODUCCIÓN" : "PRUEBAS"}`, 301, 160);
  doc.text("EMISIÓN: NORMAL", 445, 160);

  doc.roundedRect(14, 188, 267, 174, 14).stroke(border);
  doc.font("Helvetica-Bold").fontSize(7).text(config.razonSocial, 24, 220);
  doc.font("Helvetica").fontSize(7).text(config.nombreComercial, 24, 244);
  doc.text(`Dirección Matriz: ${config.direccionMatriz}`, 24, 273);
  doc.text(`Dirección Sucursal: ${config.direccionMatriz}`, 24, 298);
  doc.text("OBLIGADO A LLEVAR CONTABILIDAD: SI", 24, 328);
  doc.text("CONTRIBUYENTE ESPECIAL: NO", 24, 346);

  doc.roundedRect(291, 188, 286, 174, 14).stroke(border);
  doc.font("Helvetica").fontSize(7).text(`CLAVE DE ACCESO`, 301, 211);
  drawBarcode(invoice.clave_acceso || invoiceNumber, 301, 228, 266, 42);
  doc.fontSize(6.5).text(invoice.clave_acceso || "Pendiente", 301, 282, { width: 266, align: "center" });
  doc.text(`Fecha de emisión: ${dateInvoice(invoice.fecha_emision)}`, 301, 315);
  doc.text("Comprobante electrónico autorizado por el SRI", 301, 338);

  const customerY = 374;
  doc.roundedRect(14, customerY, pageWidth, 73, 14).stroke(border);
  cell(`Razón Social / Nombres y Apellidos: ${customerName}`, 14, customerY, 360, 24);
  cell(`RUC / CI: ${customerId}`, 14, customerY + 24, 220, 24);
  cell(`Fecha Emisión: ${dateInvoice(invoice.fecha_emision)}`, 234, customerY + 24, 190, 24);
  cell("Guía Remisión:", 424, customerY + 24, 153, 24);
  cell(`Dirección: ${config.direccionMatriz}`, 14, customerY + 48, 360, 25);
  cell(`Placa / Matrícula: ${vehiclePlate}`, 374, customerY + 48, 203, 25);

  const tableY = 456;
  const widths = [42, 55, 38, 145, 65, 42, 42, 48, 42, 40];
  const headers = ["Cod.\nPrincipal", "Cod.\nAuxiliar", "Cantidad", "Descripción", "Detalle Adicional", "Precio Unitario", "Subsidio", "Precio sin\nSubsidio", "Descuento", "Precio Total"];
  let x = 18;
  headers.forEach((header, index) => {
    const width = widths[index] || 49;
    cell(header, x, tableY, width, 31, { bold: true, size: 5.5, align: "center", fill: light });
    x += width;
  });
  x = 18;
  const values = ["001", "H492001", "1.00", description, `Placa: ${vehiclePlate}`, total, "0.00", total, "0.00", total];
  values.forEach((value, index) => {
    const width = widths[index] || 49;
    cell(value, x, tableY + 31, width, 61, { size: index === 3 || index === 4 ? 5.5 : 6, align: index === 0 || index === 1 || index === 2 ? "center" : "left" });
    x += width;
  });

  cell(`Información Adicional\nEmail Cliente: ${invoice.cliente_email || ""}\nReserva: #${invoice.reserva_id || ""}\nPlaca: ${vehiclePlate}`, 14, 590, 344, 110, { size: 6 });
  cell("SUBTOTAL 15%\nSUBTOTAL 5%\nSUBTOTAL 0%\nSUBTOTAL NO OBJETO DE IVA\nSUBTOTAL SIN IMPUESTOS\nDESCUENTO\nICE\nIVA\nPROPINA\nVALOR TOTAL", 358, 590, 130, 181, { size: 6 });
  cell(`0.00\n0.00\n${total}\n0.00\n${total}\n0.00\n0.00\n0.00\n0.00\n${total}`, 488, 590, 89, 181, { size: 6, align: "right" });
  cell("Forma de pago", 14, 700, 180, 18, { bold: true, size: 6.5, fill: light });
  cell("Valor", 194, 700, 164, 18, { bold: true, size: 6.5, fill: light });
  cell("Plazo", 14, 718, 180, 24, { size: 6 });
  cell(total, 194, 718, 164, 24, { size: 6.5, align: "right" });
  doc.font("Helvetica").fontSize(6).fillColor("#555").text("20 - OTROS CON UTILIZACIÓN DEL SISTEMA FINANCIERO", 20, 724, { width: 165 });
  doc.text("Documento generado electrónicamente. Conserve este comprobante.", 14, 805, { width: pageWidth, align: "center" });
  doc.end();
});

const emitirFacturaPorReserva = async (reservaId: number) => {
  const existing = await pool.query("SELECT * FROM facturas WHERE reserva_id = $1 LIMIT 1", [reservaId]);
  if (existing.rowCount && existing.rows[0].estado === "autorizada") return existing.rows[0];
  const result = await pool.query(
    `SELECT r.id AS reserva_id, r.total, r.origen, r.destino, v.placa AS vehiculo_placa,
            u.nombre AS cliente_nombre, u.email AS cliente_email, u.cedula AS cliente_cedula
     FROM reservas r JOIN usuarios u ON u.id = r.usuario_id
     LEFT JOIN tours t ON t.id = r.tour_id
     LEFT JOIN vehiculos v ON v.id = COALESCE(r.vehiculo_id, t.vehiculo_id)
     WHERE r.id = $1 AND r.estado_pago = 'pagado' LIMIT 1`, [reservaId]
  );
  if (!result.rowCount) throw new Error("La reserva no está completamente pagada o no existe");
  const config = sriConfig();
  if (!config.ruc || !config.direccionMatriz) throw new Error("Faltan SRI_RUC o SRI_DIRECCION_MATRIZ");
  const fecha = new Date();
  const next = await pool.query(
    "SELECT COALESCE(MAX(NULLIF(secuencial, '')::int), $1::int - 1) + 1 AS siguiente FROM facturas",
    [config.secuencial]
  );
  const secuencial = String(next.rows[0].siguiente).padStart(9, "0");
  const invoice = { ...result.rows[0], fecha_emision: fecha, secuencial, clave_acceso: claveAcceso(fecha, config, secuencial) };
  const unsignedXml = buildInvoiceXml(invoice, config);
  const xml = await signXml(unsignedXml);
  const pending = await pool.query(
    `INSERT INTO facturas (reserva_id, usuario_id, secuencial, clave_acceso, estado, total)
     SELECT r.id, r.usuario_id, $2, $3, 'pendiente', r.total FROM reservas r WHERE r.id = $1
     ON CONFLICT (reserva_id) DO UPDATE SET secuencial = EXCLUDED.secuencial, clave_acceso = EXCLUDED.clave_acceso, estado = 'pendiente'
     RETURNING *`,
    [reservaId, secuencial, invoice.clave_acceso]
  );
  const urls = sriUrls(config.environment);
  try {
    const reception = await sriRequest(urls.reception, "validarComprobante", xml);
    const receptionState = responseStatus(reception);
    if (receptionState !== "RECIBIDA") throw new Error(`SRI rechazó la recepción: ${extractMessages(reception) || receptionState}`);
    const authorization = await authorizeWithRetry(urls.authorization, invoice.clave_acceso);
    const authorizationState = responseStatus(authorization);
    if (authorizationState !== "AUTORIZADO") {
      const detail = extractSRIError(authorization) || `Estado: ${authorizationState}. El SRI todavía no devuelve la autorización.`;
      throw new Error(`SRI no autorizó la factura: ${detail || authorizationState}`);
    }
    const pdf = await generatePdf(invoice, config);
    const directory = path.join(getUploadsRoot(), "facturas");
    fs.mkdirSync(directory, { recursive: true });
    const baseName = `factura_${invoice.clave_acceso}`;
    fs.writeFileSync(path.join(directory, `${baseName}.xml`), xml);
    fs.writeFileSync(path.join(directory, `${baseName}.pdf`), pdf);
    const savedResult = await pool.query(
      `UPDATE facturas SET estado = 'autorizada', xml_autorizado = $2, pdf_url = $3, autorizado_en = NOW(), mensaje_sri = $4
       WHERE id = $1 RETURNING *`,
      [pending.rows[0].id, xml, `/uploads/facturas/${baseName}.pdf`, authorization]
    );
    const saved = savedResult.rows[0];
    await enviarCorreo({
      to: invoice.cliente_email,
      subject: `Factura autorizada TURESMA - ${invoice.clave_acceso}`,
      text: `Adjuntamos la factura autorizada de la reserva #${reservaId} en formato PDF y XML. El archivo XML es el comprobante electrónico firmado y autorizado por el SRI.`,
      html: `<p>Estimado/a ${escapeXml(invoice.cliente_nombre || "cliente")}:</p><p>Adjuntamos la factura autorizada de la reserva <strong>#${reservaId}</strong> en los formatos <strong>PDF</strong> y <strong>XML</strong>.</p><p>El archivo XML corresponde al comprobante electrónico firmado y autorizado por el SRI.</p><p>Gracias por confiar en TURESMA S.A.</p>`,
      attachments: [
        { filename: `${baseName}.pdf`, content: pdf, contentType: "application/pdf" },
        { filename: `${baseName}.xml`, content: Buffer.from(xml, "utf8"), contentType: "application/xml" },
      ],
    });
    return saved;
  } catch (error: any) {
    await pool.query("UPDATE facturas SET estado = 'rechazada', mensaje_sri = $2 WHERE id = $1", [pending.rows[0].id, error.message]);
    throw error;
  }
};

const obtenerFactura = async (reservaId: number) => {
  const result = await pool.query("SELECT * FROM facturas WHERE reserva_id = $1 LIMIT 1", [reservaId]);
  return result.rows[0] || null;
};

const reenviarFacturaPorReserva = async (reservaId: number) => {
  const result = await pool.query(
    `SELECT f.*, u.nombre AS cliente_nombre, u.email AS cliente_email
     FROM facturas f
     JOIN usuarios u ON u.id = f.usuario_id
     WHERE f.reserva_id = $1
     LIMIT 1`,
    [reservaId]
  );
  const factura = result.rows[0];
  if (!factura || factura.estado !== "autorizada" || !factura.pdf_url) {
    throw new Error("La factura todavía no está autorizada");
  }
  if (!factura.cliente_email) throw new Error("El cliente no tiene un correo registrado");

  const pdfPath = resolveStoredUploadPath(factura.pdf_url);
  if (!fs.existsSync(pdfPath)) throw new Error("No se encontró el PDF de la factura");
  const xml = factura.xml_autorizado;
  if (!xml) throw new Error("No se encontró el XML autorizado de la factura");

  const baseName = `factura_${factura.clave_acceso}`;
  const envio = await enviarCorreo({
    to: factura.cliente_email,
    subject: `Factura autorizada TURESMA - ${factura.clave_acceso}`,
    text: `Reenviamos la factura autorizada de la reserva #${reservaId} en formatos PDF y XML.`,
    html: `<p>Estimado/a ${escapeXml(factura.cliente_nombre || "cliente")}:</p><p>Reenviamos la factura autorizada de la reserva <strong>#${reservaId}</strong> en formatos <strong>PDF</strong> y <strong>XML</strong>.</p><p>Gracias por confiar en TURESMA S.A.</p>`,
    attachments: [
      { filename: `${baseName}.pdf`, path: pdfPath, contentType: "application/pdf" },
      { filename: `${baseName}.xml`, content: Buffer.from(xml, "utf8"), contentType: "application/xml" },
    ],
  });
  if (!envio.sent) throw new Error("No se pudo enviar el correo; revisa la configuración SMTP");
  return { email: factura.cliente_email };
};

module.exports = { buildInvoiceXml, signXml, emitirFacturaPorReserva, obtenerFactura, reenviarFacturaPorReserva, claveAcceso, generatePdf };
