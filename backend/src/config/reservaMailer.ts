export {};

const pool = require("./db");
const { enviarCorreo } = require("./mailer");
const { crearNotificacion, notificarAdmins } = require("./notificaciones");
const {
  escapeHtml,
  getWebBaseUrl,
  getBrandedEmailLogoAttachment,
  renderBrandedEmail,
} = require("./emailTemplate");

type TipoEvento = "confirmada" | "conductor_asignado" | "en_curso" | "finalizada" | "cancelada";
type Idioma = "es" | "en";

// Texto corto para la campanita (in-app) y asunto/mensaje del correo por evento.
const PLANTILLAS: Record<Idioma, Record<TipoEvento, { inApp: string; asunto: string; titulo: string; cuerpo: string }>> = {
  es: {
    confirmada: {
      inApp: "✅ Tu reserva #{id} está CONFIRMADA. Prepárate para tu viaje.",
      asunto: "Tu reserva en Turesma está confirmada ✅",
      titulo: "¡Reserva confirmada!",
      cuerpo: "Tu pago fue verificado y tu reserva quedó <b>confirmada</b>. Pronto un conductor te atenderá.",
    },
    conductor_asignado: {
      inApp: "Tu viaje ya tiene vehículo y conductor asignados.",
      asunto: "Tu viaje ya tiene vehículo y conductor asignados",
      titulo: "Tu viaje ya está preparado",
      cuerpo: "Turesma asignó un vehículo y un conductor para tu servicio. Revisa los datos de tu unidad y del viaje.",
    },
    en_curso: {
      inApp: "🟢 ¡Tu viaje #{id} ha comenzado! Sigue la ubicación en vivo.",
      asunto: "Tu viaje ha comenzado 🟢",
      titulo: "Viaje en curso",
      cuerpo: "Tu viaje acaba de comenzar. Puedes seguir la ubicación en vivo desde tu portal.",
    },
    finalizada: {
      inApp: "🏁 Tu viaje #{id} ha FINALIZADO. ¡Califica tu experiencia!",
      asunto: "Tu viaje finalizó — cuéntanos cómo te fue 🏁",
      titulo: "Viaje finalizado",
      cuerpo: "Tu viaje ha finalizado. ¡Gracias por viajar con Turesma! Te invitamos a calificar tu experiencia.",
    },
    cancelada: {
      inApp: "❌ Tu reserva #{id} fue cancelada. Contáctanos si necesitas ayuda.",
      asunto: "Tu reserva fue cancelada",
      titulo: "Reserva cancelada",
      cuerpo: "Lamentamos informarte que tu reserva fue cancelada. Si tienes dudas, contáctanos.",
    },
  },
  en: {
    confirmada: {
      inApp: "✅ Your reservation #{id} is CONFIRMED. Get ready for your trip.",
      asunto: "Your Turesma reservation is confirmed ✅",
      titulo: "Reservation confirmed!",
      cuerpo: "Your payment was verified and your reservation is now <b>confirmed</b>. A driver will be assigned soon.",
    },
    conductor_asignado: {
      inApp: "Your trip now has an assigned vehicle and driver.",
      asunto: "Your trip has an assigned vehicle and driver",
      titulo: "Your trip is ready",
      cuerpo: "Turesma assigned a vehicle and a driver to your service. Review your vehicle and trip details.",
    },
    en_curso: {
      inApp: "🟢 Your trip #{id} has started! Follow its live location.",
      asunto: "Your trip has started 🟢",
      titulo: "Trip in progress",
      cuerpo: "Your trip has started. You can follow its live location from your portal.",
    },
    finalizada: {
      inApp: "🏁 Your trip #{id} is COMPLETE. Rate your experience!",
      asunto: "Your trip is complete — tell us how it went 🏁",
      titulo: "Trip completed",
      cuerpo: "Your trip is complete. Thank you for traveling with Turesma! We invite you to rate your experience.",
    },
    cancelada: {
      inApp: "❌ Your reservation #{id} was cancelled. Contact us if you need help.",
      asunto: "Your reservation was cancelled",
      titulo: "Reservation cancelled",
      cuerpo: "We regret to inform you that your reservation was cancelled. Contact us if you have any questions.",
    },
  },
};

const fmtFecha = (f: any, language: Idioma = "es") => {
  if (!f) return "—";
  try {
    const value = typeof f === "string" && /^\d{4}-\d{2}-\d{2}$/.test(f) ? `${f}T12:00:00` : f;
    return new Date(value).toLocaleDateString(language === "en" ? "en-US" : "es-EC", { day: "2-digit", month: "long", year: "numeric" });
  }
  catch { return String(f); }
};

const getPublicImageUrl = (value: unknown) => {
  if (typeof value !== "string" || !value.trim()) return "";
  try {
    const apiOrigin = process.env.API_PUBLIC_URL || `http://localhost:${process.env.PORT || 4000}`;
    const imageUrl = new URL(value.trim(), `${apiOrigin.replace(/\/+$/, "")}/`);
    if (!["http:", "https:"].includes(imageUrl.protocol) || imageUrl.username || imageUrl.password) return "";
    return imageUrl.toString();
  } catch {
    return "";
  }
};

// Correo de contacto y pie estándar (mensaje automático) para todos los correos.
const CONTACTO_EMAIL = "turesmasa@hotmail.com";
const PIE_TEXTO_ES = `\n\n— Este mensaje se envió de forma automática. Para más información comunícate al correo ${CONTACTO_EMAIL}.`;
const PIE_TEXTO_EN = `\n\n— This is an automated message. For more information, contact us at ${CONTACTO_EMAIL}.`;
const PIE_TEXTO = PIE_TEXTO_ES;

// Plantilla de correo con la identidad de Turesma (rojo + datos del viaje).
const construirHtml = (tipo: TipoEvento, d: any, isReassignment = false, language: Idioma = "es") => {
  const p = PLANTILLAS[language][tipo];
  const fila = (label: string, valor: string) =>
    valor ? `<tr><td style="padding:6px 0;color:#6b7280;font-size:13px;">${escapeHtml(label)}</td><td style="padding:6px 0;color:#111827;font-size:13px;font-weight:600;text-align:right;">${escapeHtml(String(valor))}</td></tr>` : "";
  const isAssignment = tipo === "conductor_asignado";
  const title = isReassignment
    ? language === "en" ? "Your assignment has been updated" : "Actualizamos tu asignación"
    : p.titulo;
  const body = isAssignment
    ? isReassignment
      ? language === "en"
        ? "The vehicle or driver for your service has changed. Review the updated information before your trip."
        : "Actualizamos el vehículo o el conductor de tu servicio. Consulta la nueva información antes de tu viaje."
      : p.cuerpo
    : p.cuerpo;
  const imageUrl = isAssignment ? getPublicImageUrl(d.vehiculo_imagen_url) : "";
  const vehicleImage = imageUrl
    ? `<div style="margin:18px 0;padding:12px;border:1px solid #e5e7eb;border-radius:12px;text-align:center;">
         <img src="${escapeHtml(imageUrl)}" alt="${language === "en" ? "Vehicle assigned to reservation" : "Vehículo asignado a la reserva"} ${escapeHtml(String(d.id))}" style="display:block;width:100%;max-width:420px;max-height:240px;object-fit:cover;margin:0 auto;border-radius:8px;">
         <p style="margin:8px 0 0;color:#6b7280;font-size:11px;">${language === "en" ? "Assigned vehicle photo" : "Foto del vehículo asignado"}</p>
       </div>`
    : isAssignment
      ? `<p style="margin:16px 0;color:#64748b;font-size:12px;">${language === "en" ? "No vehicle photo is available. Check the plate and model listed below." : "No hay una foto disponible de la unidad. Verifica la placa y el modelo indicados."}</p>`
      : "";
  const webUrl = getWebBaseUrl();
  const action = isAssignment
    ? `${webUrl}/cliente/historial`
    : undefined;
  const bodyHtml = `
    <p style="margin:0 0 18px;color:#374151;font-size:14px;line-height:1.6">${language === "en" ? "Hello" : "Hola"} <strong>${escapeHtml(String(d.cliente_nombre || (language === "en" ? "customer" : "cliente")))}</strong>, ${body}</p>
    <table role="presentation" style="width:100%;border-collapse:collapse;border-top:1px solid #e2e8f0">
      ${fila(language === "en" ? "Reservation" : "Reserva", "#" + d.id)}
      ${fila(language === "en" ? "Origin" : "Origen", d.origen)}
      ${fila(language === "en" ? "Destination" : "Destino", d.destino)}
      ${fila(language === "en" ? "Date" : "Fecha", fmtFecha(d.fecha_reserva, language))}
      ${fila(language === "en" ? "Vehicle" : "Vehículo", d.vehiculo_placa ? `${d.vehiculo_placa}${d.vehiculo_modelo ? " · " + d.vehiculo_modelo : ""}` : "")}
      ${fila(language === "en" ? "Driver" : "Conductor", d.conductor_nombre)}
      ${fila(language === "en" ? "Total" : "Total", d.total != null ? "$" + Number(d.total).toFixed(2) : "")}
    </table>
    ${vehicleImage}
  `;

  return renderBrandedEmail({
    preheader: `${title} · Reserva #${d.id}`,
    eyebrow: isAssignment
      ? language === "en" ? "YOUR TRIP DETAILS" : "INFORMACIÓN DE TU VIAJE"
      : language === "en" ? "YOUR RESERVATION DETAILS" : "INFORMACIÓN DE TU RESERVA",
    title,
    bodyHtml,
    actionLabel: isAssignment
      ? language === "en" ? "View reservation and contact your driver" : "Ver reserva y contactar al conductor"
      : undefined,
    actionUrl: action,
    contactEmail: CONTACTO_EMAIL,
  });
};

// Notifica al CLIENTE de un cambio de estado de su reserva: crea la notificación
// in-app (campanita) y envía el correo. Todo best-effort: si algo falla, se
// registra pero NO se interrumpe la operación que la disparó.
const notificarClienteReserva = async (
  reservaId: number,
  tipo: TipoEvento,
  senderId: number | null | undefined,
  isReassignment = false
) => {
  try {
    const r = await pool.query(
      `SELECT r.id, r.origen, r.destino, r.fecha_reserva, r.total, r.usuario_id,
              u.nombre AS cliente_nombre, u.email AS cliente_email,
              u.preferred_language,
              v.placa AS vehiculo_placa, v.modelo AS vehiculo_modelo, v.imagen_url AS vehiculo_imagen_url,
              concat_ws(' ', c.nombre, c.apellido) AS conductor_nombre
       FROM reservas r
       JOIN usuarios u ON u.id = r.usuario_id
       LEFT JOIN vehiculos v ON v.id = r.vehiculo_id
       LEFT JOIN usuarios c ON c.id = r.conductor_id
       WHERE r.id = $1
       LIMIT 1`,
      [reservaId]
    );
    if (r.rowCount === 0) return;
    const d = r.rows[0];
    const language: Idioma = d.preferred_language === "en" ? "en" : "es";
    const p = PLANTILLAS[language][tipo];
    if (!p) return;
    const vehicleDetails = [d.vehiculo_placa, d.vehiculo_modelo, d.conductor_nombre].filter(Boolean).join(" · ");
    const buildInAppMessage = (targetLanguage: Idioma) => {
      const template = PLANTILLAS[targetLanguage][tipo];
      if (tipo !== "conductor_asignado") return template.inApp.replace("{id}", String(reservaId));
      const assignmentTitle = targetLanguage === "en"
        ? isReassignment ? "🔄 Your assignment was updated" : "🚐 Turesma assigned resources"
        : isReassignment ? "🔄 Actualizamos la asignación" : "🚐 Turesma asignó los recursos";
      const followUp = targetLanguage === "en"
        ? "Review the details and contact your driver from your portal."
        : "Consulta los detalles y contacta al conductor desde tu portal.";
      return `${assignmentTitle} for reservation #${reservaId}${vehicleDetails ? `: ${vehicleDetails}` : ""}. ${followUp}`;
    };
    const spanishMessage = buildInAppMessage("es");
    const englishMessage = buildInAppMessage("en");
    const inAppMessage = language === "en" ? englishMessage : spanishMessage;

    // 1) Notificación in-app (campanita del cliente)
    await crearNotificacion(senderId, d.usuario_id, spanishMessage, reservaId, "reserva", reservaId, englishMessage);

    // 2) Correo (si el cliente tiene email y el SMTP está configurado).
    //    Cuando la reserva queda CONFIRMADA, se adjunta el PDF de la proforma.
    if (d.cliente_email) {
      const subject = tipo === "conductor_asignado" && isReassignment
        ? language === "en" ? "Your trip's vehicle and driver assignment has changed" : "Actualizamos el vehículo y conductor de tu viaje"
        : p.asunto;
      const assignmentText = tipo === "conductor_asignado"
        ? language === "en"
          ? `\nVehicle: ${[d.vehiculo_placa, d.vehiculo_modelo].filter(Boolean).join(" · ") || "To be confirmed"}\nDriver: ${d.conductor_nombre || "To be confirmed"}\nView your reservation and contact your driver: ${getWebBaseUrl()}/cliente/historial`
          : `\nVehículo: ${[d.vehiculo_placa, d.vehiculo_modelo].filter(Boolean).join(" · ") || "Por confirmar"}\nConductor: ${d.conductor_nombre || "Por confirmar"}\nConsulta tu reserva y contacta al conductor: ${getWebBaseUrl()}/cliente/historial`
        : "";
      const attachments: any[] = [getBrandedEmailLogoAttachment()];
      if (tipo === "confirmada") {
        try {
          const { getCotizacionIdDeReserva, buildProformaData, generarProformaPDF } = require("./proforma");
          const cotId = await getCotizacionIdDeReserva(reservaId);
          if (cotId) {
            const prof = await buildProformaData(cotId);
            if (prof) {
              const pdf = await generarProformaPDF(prof);
              attachments.push({ filename: `Proforma-${prof.numero}.pdf`, content: pdf });
            }
          }
        } catch (err: any) {
          console.error("No se pudo adjuntar la proforma:", err?.message || err);
        }
      }
      await enviarCorreo({
        to: d.cliente_email,
        subject,
        html: construirHtml(tipo, d, isReassignment, language),
        text: `${inAppMessage}${assignmentText}${language === "en" ? PIE_TEXTO_EN : PIE_TEXTO_ES}`,
        attachments,
      });
    }
  } catch (e: any) {
    console.error("Error notificando al cliente (reserva " + reservaId + "):", e?.message || e);
  }
};

const notificarClienteOperacion = async (
  operationId: number,
  senderId: number | null | undefined,
  event: "asignada" | "en_curso" | "completada"
) => {
  try {
    const result = await pool.query(
      `SELECT o.id, o.reserva_id, o.requerimiento_id, o.grupo_numero, o.unidad_numero,
              o.fecha_programada, o.origen, o.destino, o.estado,
              r.usuario_id, r.fecha_reserva, r.total,
              u.nombre AS cliente_nombre, u.email AS cliente_email, u.preferred_language,
              v.placa AS vehiculo_placa, v.modelo AS vehiculo_modelo, v.imagen_url AS vehiculo_imagen_url,
              concat_ws(' ', c.nombre, c.apellido) AS conductor_nombre,
              c.id AS conductor_usuario_id
       FROM operaciones o
       JOIN reservas r ON r.id = o.reserva_id
       JOIN usuarios u ON u.id = r.usuario_id
       LEFT JOIN vehiculos v ON v.id = o.vehiculo_id
       LEFT JOIN conductores cd ON cd.id = o.conductor_id
       LEFT JOIN usuarios c ON c.id = cd.usuario_id
       WHERE o.id = $1 AND o.requerimiento_id IS NOT NULL
       LIMIT 1`,
      [operationId]
    );
    if (!result.rowCount) return;
    const operation = result.rows[0];
    const language: Idioma = operation.preferred_language === "en" ? "en" : "es";
    const unitLabel = `requerimiento #${operation.requerimiento_id}, grupo ${operation.grupo_numero}, unidad ${operation.unidad_numero}`;
    const unitLabelEn = `request #${operation.requerimiento_id}, group ${operation.grupo_numero}, unit ${operation.unidad_numero}`;
    const vehicleLabel = [operation.vehiculo_placa, operation.vehiculo_modelo].filter(Boolean).join(" · ");
    const buildMessage = (targetLanguage: Idioma) => {
      if (event === "asignada") {
        return targetLanguage === "en"
          ? `Your ${unitLabelEn} now has resources assigned${vehicleLabel ? `: ${vehicleLabel}` : ""}${operation.conductor_nombre ? ` · ${operation.conductor_nombre}` : ""}. Review reservation #${operation.reserva_id} in your portal.`
          : `Tu ${unitLabel} ya tiene recursos asignados${vehicleLabel ? `: ${vehicleLabel}` : ""}${operation.conductor_nombre ? ` · ${operation.conductor_nombre}` : ""}. Revisa la reserva #${operation.reserva_id} en tu portal.`;
      }
      if (event === "en_curso") {
        return targetLanguage === "en"
          ? `The driver has started ${unitLabelEn} for reservation #${operation.reserva_id}.`
          : `El conductor inició la ${unitLabel} de tu reserva #${operation.reserva_id}.`;
      }
      return targetLanguage === "en"
        ? `${unitLabelEn} for reservation #${operation.reserva_id} has been completed.`
        : `La ${unitLabel} de tu reserva #${operation.reserva_id} fue completada.`;
    };
    const spanishMessage = buildMessage("es");
    const englishMessage = buildMessage("en");
    const message = language === "en" ? englishMessage : spanishMessage;

    await crearNotificacion(senderId, operation.usuario_id, spanishMessage, operation.reserva_id, "reserva", operation.reserva_id, englishMessage);
    if (operation.cliente_email) {
      const imageUrl = getPublicImageUrl(operation.vehiculo_imagen_url);
      const image = imageUrl
        ? `<p style="text-align:center"><img src="${escapeHtml(imageUrl)}" alt="Vehículo asignado" style="max-width:100%;max-height:240px;border-radius:8px"></p>`
        : "";
      const customerMessage = escapeHtml(message);
      const safeOrigin = escapeHtml(String(operation.origen || "—"));
      const safeDestination = escapeHtml(String(operation.destino || "—"));
      const safeVehicle = escapeHtml(vehicleLabel || "Por confirmar");
      const safeDriver = escapeHtml(String(operation.conductor_nombre || "Por confirmar"));
      const safeDate = escapeHtml(fmtFecha(operation.fecha_programada, language));
      const labels = language === "en"
        ? { route: "Route", date: "Date", vehicle: "Vehicle", driver: "Driver", assigned: "Resources assigned to your service", update: "Service update", greeting: "customer", action: "View reservation status" }
        : { route: "Ruta", date: "Fecha", vehicle: "Vehículo", driver: "Conductor", assigned: "Recursos asignados a tu servicio", update: "Actualización de tu servicio", greeting: "cliente", action: "Ver estado de la reserva" };
      await enviarCorreo({
        to: operation.cliente_email,
        subject: event === "asignada"
          ? language === "en" ? "A vehicle has been assigned to your custom service" : "Unidad de tu servicio personalizado asignada"
          : language === "en" ? "Your custom service has been updated" : "Actualización de tu servicio personalizado",
        html: renderBrandedEmail({
          preheader: message,
          eyebrow: language === "en" ? "CUSTOM SERVICE" : "SERVICIO PERSONALIZADO",
          title: event === "asignada" ? labels.assigned : labels.update,
          bodyHtml: `<p style="margin:0 0 12px">${language === "en" ? "Hello" : "Hola"} <strong>${escapeHtml(String(operation.cliente_nombre || labels.greeting))}</strong>:</p>
            <p style="margin:0 0 16px">${customerMessage}</p>
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-top:1px solid #e2e8f0">
              <tr><td style="padding:8px 0;color:#64748b">${labels.route}</td><td style="padding:8px 0;text-align:right;font-weight:bold;color:#111827">${safeOrigin} → ${safeDestination}</td></tr>
              <tr><td style="padding:8px 0;color:#64748b">${labels.date}</td><td style="padding:8px 0;text-align:right;font-weight:bold;color:#111827">${safeDate}</td></tr>
              <tr><td style="padding:8px 0;color:#64748b">${labels.vehicle}</td><td style="padding:8px 0;text-align:right;font-weight:bold;color:#111827">${safeVehicle}</td></tr>
              <tr><td style="padding:8px 0;color:#64748b">${labels.driver}</td><td style="padding:8px 0;text-align:right;font-weight:bold;color:#111827">${safeDriver}</td></tr>
            </table>${image}`,
          actionLabel: labels.action,
          actionUrl: `${getWebBaseUrl()}/cliente/historial`,
          contactEmail: CONTACTO_EMAIL,
        }),
        text: `${message}\n${labels.route}: ${operation.origen} → ${operation.destino}\n${labels.vehicle}: ${vehicleLabel || (language === "en" ? "To be confirmed" : "Por confirmar")}\n${labels.driver}: ${operation.conductor_nombre || (language === "en" ? "To be confirmed" : "Por confirmar")}\n${getWebBaseUrl()}/cliente/historial${language === "en" ? PIE_TEXTO_EN : PIE_TEXTO_ES}`,
        attachments: [getBrandedEmailLogoAttachment()],
      });
    }
  } catch (error: any) {
    console.error(`Error notificando la operación personalizada #${operationId}:`, error?.message || error);
  }
};

const notificarConductorOperacion = async (
  operationId: number,
  senderId: number | null | undefined,
  isReassignment = false,
  event: "asignada" | "completada" = "asignada"
) => {
  try {
    const result = await pool.query(
      `SELECT o.id, o.reserva_id, o.requerimiento_id, o.grupo_numero, o.unidad_numero,
              o.fecha_programada, o.hora_inicio, o.origen, o.destino, o.pasajeros, o.itinerario,
              c.usuario_id AS conductor_usuario_id,
              u.nombre AS conductor_nombre, u.email AS conductor_email,
              v.placa AS vehiculo_placa, v.modelo AS vehiculo_modelo
       FROM operaciones o
       JOIN conductores c ON c.id = o.conductor_id
       JOIN usuarios u ON u.id = c.usuario_id
       LEFT JOIN vehiculos v ON v.id = o.vehiculo_id
       WHERE o.id = $1
         AND ($2::text <> 'asignada' OR o.estado = 'asignada')
       LIMIT 1`,
      [operationId, event]
    );
    if (!result.rowCount) return false;

    const operation = result.rows[0];
    const reservationLabel = operation.reserva_id ? `reserva #${operation.reserva_id}` : `servicio #${operation.id}`;
    const unitLabel = operation.requerimiento_id
      ? ` · Grupo ${operation.grupo_numero}, unidad ${operation.unidad_numero}`
      : "";
    const vehicleLabel = [operation.vehiculo_placa, operation.vehiculo_modelo].filter(Boolean).join(" · ") || "Por confirmar";
    const message = event === "completada"
      ? `El servicio ${reservationLabel}${unitLabel} quedó registrado como completado.`
      : isReassignment
        ? `Se actualizó tu asignación para la ${reservationLabel}${unitLabel}. Revisa los nuevos datos del servicio.`
        : `Tienes un nuevo servicio asignado: ${reservationLabel}${unitLabel}, ${operation.origen} → ${operation.destino}.`;

    if (event === "asignada") {
      await crearNotificacion(
        senderId,
        operation.conductor_usuario_id,
        message,
        operation.reserva_id || null,
        operation.reserva_id ? "reserva" : null,
        operation.reserva_id || null
      );
    }

    if (!operation.conductor_email) return false;

    const safeOrigin = escapeHtml(String(operation.origen || "—"));
    const safeDestination = escapeHtml(String(operation.destino || "—"));
    const safeVehicle = escapeHtml(vehicleLabel);
    const safeDate = escapeHtml(fmtFecha(operation.fecha_programada));
    const safeTime = escapeHtml(String(operation.hora_inicio || "Por confirmar").slice(0, 5));
    const safePassengerCount = escapeHtml(String(operation.pasajeros || "—"));
    const title = event === "completada"
      ? "Servicio completado"
      : isReassignment ? "Se actualizó tu servicio" : "Tienes un nuevo servicio asignado";
    const webUrl = getWebBaseUrl();
    const itinerary = Array.isArray(operation.itinerario) ? operation.itinerario : [];
    const itineraryRows = itinerary.map((point: Record<string, unknown>, index: number) => {
      const destination = String(point.label || point.destino || "Destino");
      const details = [
        point.fecha_llegada ? `Llegada: ${fmtFecha(point.fecha_llegada)}` : "",
        Number(point.dias_estadia) ? `Estadía: ${point.dias_estadia} día(s)` : "",
        point.hora_salida ? `Salida: ${point.hora_salida}` : "",
        point.es_retorno ? "Retorno al origen" : "",
      ].filter(Boolean).join(" · ");
      return `<tr><td style="padding:6px 0;color:#64748b">${index + 1}.</td><td style="padding:6px 0;color:#111827;font-weight:600">${escapeHtml(destination)}${details ? `<br><span style="font-size:11px;color:#64748b;font-weight:400">${escapeHtml(details)}</span>` : ""}</td></tr>`;
    }).join("");
    const itineraryHtml = itineraryRows
      ? `<p style="margin:18px 0 6px;font-weight:bold;color:#111827">Recorrido</p><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">${itineraryRows}</table>`
      : "";
    const actionUrl = event === "asignada"
      ? `${webUrl}/vehiculo/activas#operacion-${operation.id}`
      : `${webUrl}/vehiculo/activas`;

    await enviarCorreo({
      to: operation.conductor_email,
      subject: `${title} · ${reservationLabel}`,
      html: renderBrandedEmail({
        preheader: message,
        eyebrow: event === "completada" ? "CIERRE DEL SERVICIO" : "ASIGNACIÓN DE SERVICIO",
        title,
        bodyHtml: `<p style="margin:0 0 16px">Hola <strong>${escapeHtml(String(operation.conductor_nombre || "conductor"))}</strong>, ${escapeHtml(message)}</p>
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-top:1px solid #e2e8f0">
            <tr><td style="padding:8px 0;color:#64748b">Ruta</td><td style="padding:8px 0;text-align:right;font-weight:bold;color:#111827">${safeOrigin} → ${safeDestination}</td></tr>
            <tr><td style="padding:8px 0;color:#64748b">Fecha</td><td style="padding:8px 0;text-align:right;font-weight:bold;color:#111827">${safeDate}</td></tr>
            <tr><td style="padding:8px 0;color:#64748b">Hora de salida</td><td style="padding:8px 0;text-align:right;font-weight:bold;color:#111827">${safeTime}</td></tr>
            <tr><td style="padding:8px 0;color:#64748b">Vehículo</td><td style="padding:8px 0;text-align:right;font-weight:bold;color:#111827">${safeVehicle}</td></tr>
            <tr><td style="padding:8px 0;color:#64748b">Pasajeros</td><td style="padding:8px 0;text-align:right;font-weight:bold;color:#111827">${safePassengerCount}</td></tr>
          </table>${itineraryHtml}`,
        actionLabel: "Ver mis servicios",
        actionUrl,
        contactEmail: CONTACTO_EMAIL,
      }),
      text: `${message}\nRuta: ${operation.origen} → ${operation.destino}\n${itinerary.map((point: Record<string, unknown>, index: number) => `${index + 1}. ${point.label || point.destino}${point.fecha_llegada ? ` · llegada ${fmtFecha(point.fecha_llegada)}` : ""}${Number(point.dias_estadia) ? ` · estadía ${point.dias_estadia} día(s)` : ""}${point.hora_salida ? ` · salida ${point.hora_salida}` : ""}${point.es_retorno ? " · retorno al origen" : ""}`).join("\n")}\nFecha: ${fmtFecha(operation.fecha_programada)}\nHora de salida: ${safeTime}\nVehículo: ${vehicleLabel}\nPasajeros: ${operation.pasajeros || "—"}\n${actionUrl}${PIE_TEXTO}`,
      attachments: [getBrandedEmailLogoAttachment()],
    });
    return true;
  } catch (error: any) {
    console.error(`Error notificando al conductor de la operación #${operationId}:`, error?.message || error);
    return false;
  }
};

// El cliente reprogramó su reserva: correo de confirmación al cliente + aviso
// in-app al admin y al conductor con la nueva fecha/hora. Todo best-effort.
const notificarReprogramacion = async (reservaId: number, senderId: number | null | undefined) => {
  try {
    const r = await pool.query(
      `SELECT r.id, r.origen, r.destino, r.fecha_reserva, r.fecha_regreso, r.hora_regreso, r.usuario_id, r.conductor_id,
              u.nombre AS cliente_nombre, u.email AS cliente_email, u.preferred_language,
              co.hora_salida
       FROM reservas r
       JOIN usuarios u ON u.id = r.usuario_id
       LEFT JOIN cotizaciones co ON co.reserva_id = r.id
       WHERE r.id = $1 LIMIT 1`,
      [reservaId]
    );
    if (r.rowCount === 0) return;
    const d = r.rows[0];
    const language: Idioma = d.preferred_language === "en" ? "en" : "es";
    const cuando = `${fmtFecha(d.fecha_reserva)}${d.hora_salida ? " · " + d.hora_salida : ""}${d.fecha_regreso ? ` · Regreso: ${fmtFecha(d.fecha_regreso)}${d.hora_regreso ? " · " + d.hora_regreso : ""}` : ""}`;
    const when = `${fmtFecha(d.fecha_reserva, language)}${d.hora_salida ? " · " + d.hora_salida : ""}${d.fecha_regreso ? ` · ${language === "en" ? "Return" : "Regreso"}: ${fmtFecha(d.fecha_regreso, language)}${d.hora_regreso ? " · " + d.hora_regreso : ""}` : ""}`;

    // 1) Correo al cliente (confirmando su cambio)
    if (d.cliente_email) {
      const copy = language === "en"
        ? {
          preheader: `Change confirmed for reservation #${reservaId}.`,
          eyebrow: "RESERVATION UPDATE",
          title: "Reservation updated",
          greeting: "We recorded the change to your reservation",
          departure: "Your new departure date and time is:",
          notified: "The driver and Turesma team have been notified. Have a great trip!",
          subject: "Your reservation date/time has changed — Turesma",
          text: `Your reservation #${reservaId} was updated. New departure: ${when}.`,
        }
        : {
          preheader: `Cambio confirmado para la reserva #${reservaId}.`,
          eyebrow: "ACTUALIZACIÓN DE TU RESERVA",
          title: "Cambio en tu reserva",
          greeting: "Registramos el cambio en tu reserva",
          departure: "Tu nueva fecha y hora de salida es:",
          notified: "Ya avisamos al conductor y al equipo de Turesma. ¡Buen viaje!",
          subject: "Cambiaste la fecha/hora de tu reserva — Turesma",
          text: `Cambiaste tu reserva #${reservaId}. Nueva salida: ${when}.`,
        };
      const html = renderBrandedEmail({
        preheader: copy.preheader,
        eyebrow: copy.eyebrow,
        title: copy.title,
        bodyHtml: `
          <p style="margin:0 0 12px">${language === "en" ? "Hello" : "Hola"} <strong>${escapeHtml(String(d.cliente_nombre || (language === "en" ? "customer" : "cliente")))}</strong>, ${copy.greeting} <strong>#${reservaId}</strong> (${escapeHtml(String(d.origen || "—"))} → ${escapeHtml(String(d.destino || "—"))}).</p>
          <p style="margin:0 0 12px">${copy.departure}</p>
          <p style="margin:0 0 12px;font-size:18px;font-weight:800;color:#0b0f1a">${escapeHtml(when)}</p>
          <p style="margin:0">${copy.notified}</p>`,
        contactEmail: CONTACTO_EMAIL,
      });
      await enviarCorreo({
        to: d.cliente_email,
        subject: copy.subject,
        html,
        text: `${copy.text}${language === "en" ? PIE_TEXTO_EN : PIE_TEXTO_ES}`,
        attachments: [getBrandedEmailLogoAttachment()],
      });
    }

    // 2) Aviso in-app al admin
    await notificarAdmins(
      senderId,
      `${d.cliente_nombre || "Un cliente"} reprogramó la reserva #${reservaId} (${d.origen} → ${d.destino}). Nueva salida: ${cuando}.`,
      "reserva",
      reservaId
    );

    // 3) Aviso in-app al conductor (reservas.conductor_id → usuarios.id)
    if (d.conductor_id) {
      await crearNotificacion(
        senderId,
        d.conductor_id,
        `La reserva #${reservaId} fue reprogramada. Nueva salida: ${cuando}. Revisa tu agenda.`,
        reservaId,
        "reserva",
        reservaId
      );
    }
  } catch (e: any) {
    console.error("Error notificando reprogramación (reserva " + reservaId + "):", e?.message || e);
  }
};

module.exports = {
  notificarClienteReserva,
  notificarClienteOperacion,
  notificarConductorOperacion,
  notificarReprogramacion,
};
