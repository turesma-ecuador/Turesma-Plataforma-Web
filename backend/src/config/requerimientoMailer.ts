export {};

const pool = require("./db");
const { enviarCorreo } = require("./mailer");
const { buildProformaDataRequerimiento, generarProformaPDF } = require("./proforma");
const {
  escapeHtml,
  getWebBaseUrl,
  getBrandedEmailLogoAttachment,
  renderBrandedEmail,
} = require("./emailTemplate");

const CONTACTO_EMAIL = "turesmasa@hotmail.com";

const formatDate = (value: unknown) => {
  if (!value) return "Por confirmar";
  const dateValue = String(value);
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(dateValue) ? `${dateValue}T12:00:00` : dateValue;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime())
    ? dateValue
    : date.toLocaleDateString("es-EC", { day: "2-digit", month: "long", year: "numeric" });
};

const safe = (value: unknown) => escapeHtml(value == null ? "" : String(value));

const obtenerDestinatario = async (request: any) => {
  const recipientResult = await pool.query(
    "SELECT nombre, email FROM usuarios WHERE id = $1 AND activo = true LIMIT 1",
    [request.usuario_id]
  );
  const recipient = recipientResult.rows[0];
  if (!recipient?.email) {
    console.error("No se pudo enviar el requerimiento: cliente sin correo", {
      requerimientoId: request.id,
    });
    return null;
  }
  return recipient;
};

const notificarRespuestaRequerimiento = async (request: any) => {
  try {
    const recipient = await obtenerDestinatario(request);
    if (!recipient) return { sent: false, reason: "recipient_unavailable" };

    const webUrl = `${getWebBaseUrl()}/cliente/requerimiento-personalizado`;
    const responseHtml = safe(request.respuesta_admin).replace(/\r?\n/g, "<br>");
    const html = renderBrandedEmail({
      preheader: `Turesma respondió tu requerimiento personalizado #${request.id}.`,
      eyebrow: "ACTUALIZACIÓN DE REQUERIMIENTO",
      title: "Tienes una respuesta de Turesma",
      bodyHtml: `
        <p style="margin:0 0 16px">Hola <strong>${safe(recipient.nombre || "cliente")}</strong>, respondimos a tu requerimiento personalizado <strong>#${safe(request.id)}</strong>.</p>
        <div style="padding:16px;border:1px solid #e2e8f0;border-radius:12px;background:#f8fafc;white-space:pre-line">${responseHtml}</div>`,
      actionLabel: "Ver mi requerimiento",
      actionUrl: webUrl,
      contactEmail: CONTACTO_EMAIL,
    });
    const text = [
      `Hola ${recipient.nombre || "cliente"}, Turesma respondió a tu requerimiento personalizado #${request.id}.`,
      request.respuesta_admin,
      `Consulta tu requerimiento: ${webUrl}`,
      `Para más información, comunícate al correo ${CONTACTO_EMAIL}.`,
    ].filter(Boolean).join("\n\n");

    return await enviarCorreo({
      to: recipient.email,
      subject: `Turesma respondió tu requerimiento #${request.id}`,
      html,
      text,
      attachments: [getBrandedEmailLogoAttachment()],
    });
  } catch (error) {
    console.error("Error notificando la respuesta del requerimiento personalizado:", {
      requerimientoId: request?.id,
      message: error instanceof Error ? error.message : String(error),
    });
    return { sent: false, reason: "error" };
  }
};

const notificarPropuestaRequerimiento = async (request: any) => {
  try {
    const recipient = await obtenerDestinatario(request);
    if (!recipient) return { sent: false, reason: "recipient_unavailable" };

    const proformaData = await buildProformaDataRequerimiento(Number(request.id), Number(request.usuario_id));
    if (!proformaData) return { sent: false, reason: "proforma_unavailable" };
    const proformaPdf = await generarProformaPDF(proformaData);

    const groups = Array.isArray(request.service_groups) ? request.service_groups : [];
    const total = Number(request.precio_final);
    const formattedTotal = Number.isFinite(total) ? total.toFixed(2) : "0.00";
    const groupRows = groups.flatMap((group: any, index: number) => {
      if (group.incluido_en_propuesta === false) return [];
      const subtotal = Number(group.precio_total);
      const formattedSubtotal = Number.isFinite(subtotal) ? subtotal.toFixed(2) : "0.00";
      const route = [group.origen, group.destino].filter(Boolean).map(safe).join(" → ") || "Ruta por confirmar";
      const serviceDate = group.fecha_fin && group.fecha_fin !== group.fecha_servicio
        ? `${formatDate(group.fecha_servicio)} – ${formatDate(group.fecha_fin)}`
        : formatDate(group.fecha_servicio);
      return [`
        <tr>
          <td style="padding:10px 8px;border-bottom:1px solid #e2e8f0;color:#334155;font-size:13px">
            <strong>Grupo ${index + 1}</strong><br>
            ${safe(group.cantidad_vehiculos)} vehículo(s)${group.tipo_vehiculo ? ` · ${safe(group.tipo_vehiculo)}` : ""}<br>
            ${route}<br>
            ${safe(serviceDate)}${group.hora_salida ? ` · ${safe(group.hora_salida)}` : ""}
          </td>
          <td style="padding:10px 8px;border-bottom:1px solid #e2e8f0;color:#111827;font-size:13px;font-weight:700;text-align:right;white-space:nowrap">
            $${formattedSubtotal}
          </td>
        </tr>`];
    }).join("");
    const excludedGroups = groups
      .map((group: any, index: number) => ({ group, index }))
      .filter(({ group }: any) => group.incluido_en_propuesta === false);
    const excludedGroupsHtml = excludedGroups.length
      ? `<p style="margin:18px 0 6px"><strong>Grupos no incluidos en esta propuesta:</strong></p><ul style="margin:0;padding-left:22px">${excludedGroups.map(({ group, index }: any) =>
        `<li style="margin:4px 0">Grupo ${index + 1}${group.motivo_no_inclusion ? `: ${safe(group.motivo_no_inclusion)}` : ""}</li>`
      ).join("")}</ul>`
      : "";
    const responseNote = request.respuesta_admin
      ? `<p style="margin:18px 0 0;white-space:pre-line"><strong>Mensaje de Turesma:</strong><br>${safe(request.respuesta_admin)}</p>`
      : "";
    const webUrl = `${getWebBaseUrl()}/cliente/requerimiento-personalizado`;
    const html = renderBrandedEmail({
      preheader: `Ya puedes revisar la propuesta de tu requerimiento #${request.id}: $${formattedTotal}.`,
      eyebrow: "PROPUESTA DE SERVICIO",
      title: "Tu propuesta está lista",
      bodyHtml: `
        <p style="margin:0 0 16px">Hola <strong>${safe(recipient.nombre || "cliente")}</strong>, Turesma preparó una propuesta para tu requerimiento personalizado <strong>#${safe(request.id)}</strong>.</p>
        <table role="presentation" style="width:100%;border-collapse:collapse;border-top:1px solid #e2e8f0">
          <thead><tr>
            <th style="padding:8px;text-align:left;color:#64748b;font-size:11px">SERVICIO</th>
            <th style="padding:8px;text-align:right;color:#64748b;font-size:11px">SUBTOTAL</th>
          </tr></thead>
          <tbody>${groupRows}</tbody>
          <tfoot><tr>
            <td style="padding:12px 8px;color:#111827;font-size:14px;font-weight:700">Total de la propuesta</td>
            <td style="padding:12px 8px;color:#047857;font-size:16px;font-weight:800;text-align:right;white-space:nowrap">$${formattedTotal}</td>
          </tr></tfoot>
        </table>
        ${excludedGroupsHtml}
        ${responseNote}`,
      actionLabel: "Revisar propuesta",
      actionUrl: webUrl,
      contactEmail: CONTACTO_EMAIL,
    });
    const groupText = groups.flatMap((group: any, index: number) =>
      group.incluido_en_propuesta === false
        ? [`Grupo ${index + 1}: No incluido en esta propuesta${group.motivo_no_inclusion ? ` — ${group.motivo_no_inclusion}` : ""}`]
        : [`Grupo ${index + 1}: ${group.origen || "Ruta por confirmar"} → ${group.destino || "Ruta por confirmar"} — $${Number(group.precio_total || 0).toFixed(2)}`]
    ).join("\n");
    const text = [
      `Hola ${recipient.nombre || "cliente"}, Turesma preparó la propuesta de tu requerimiento personalizado #${request.id}.`,
      groupText,
      `Total de la propuesta: $${formattedTotal}`,
      request.respuesta_admin ? `Mensaje de Turesma: ${request.respuesta_admin}` : "",
      `Revisa tu propuesta: ${webUrl}`,
      `Para más información, comunícate al correo ${CONTACTO_EMAIL}.`,
    ].filter(Boolean).join("\n\n");

    return await enviarCorreo({
      to: recipient.email,
      subject: `Tu propuesta de Turesma está lista · Requerimiento #${request.id}`,
      html,
      text,
      attachments: [
        getBrandedEmailLogoAttachment(),
        {
          filename: `Proforma-REQ-${request.id}.pdf`,
          content: proformaPdf,
          contentType: "application/pdf",
        },
      ],
    });
  } catch (error) {
    console.error("Error notificando la propuesta del requerimiento personalizado:", {
      requerimientoId: request?.id,
      message: error instanceof Error ? error.message : String(error),
    });
    return { sent: false, reason: "error" };
  }
};

module.exports = { notificarRespuestaRequerimiento, notificarPropuestaRequerimiento };
