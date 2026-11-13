export {};

const pool = require("./db");
const { enviarCorreo } = require("./mailer");
const { crearNotificacion, notificarAdmins } = require("./notificaciones");
const { escapeHtml, getWebBaseUrl } = require("./emailTemplate");

type TipoEvento = "confirmada" | "conductor_asignado" | "en_curso" | "finalizada" | "cancelada";

// Texto corto para la campanita (in-app) y asunto/mensaje del correo por evento.
const PLANTILLAS: Record<TipoEvento, { inApp: string; asunto: string; titulo: string; cuerpo: string }> = {
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
};

const fmtFecha = (f: any) => {
  if (!f) return "—";
  try { return new Date(f).toLocaleDateString("es-EC", { day: "2-digit", month: "long", year: "numeric" }); }
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
const PIE_HTML = `<p style="margin:22px 0 0;color:#9ca3af;font-size:11px;text-align:center;line-height:1.5;">Este mensaje se envió de forma automática. Para más información comunícate al correo <a href="mailto:${CONTACTO_EMAIL}" style="color:#9ca3af;">${CONTACTO_EMAIL}</a>.</p>`;
const PIE_TEXTO = `\n\n— Este mensaje se envió de forma automática. Para más información comunícate al correo ${CONTACTO_EMAIL}.`;

// Plantilla de correo con la identidad de Turesma (rojo + datos del viaje).
const construirHtml = (tipo: TipoEvento, d: any, isReassignment = false) => {
  const p = PLANTILLAS[tipo];
  const fila = (label: string, valor: string) =>
    valor ? `<tr><td style="padding:6px 0;color:#6b7280;font-size:13px;">${escapeHtml(label)}</td><td style="padding:6px 0;color:#111827;font-size:13px;font-weight:600;text-align:right;">${escapeHtml(String(valor))}</td></tr>` : "";
  const isAssignment = tipo === "conductor_asignado";
  const title = isReassignment ? "Actualizamos tu asignación" : p.titulo;
  const body = isAssignment
    ? isReassignment
      ? "Actualizamos el vehículo o el conductor de tu servicio. Consulta la nueva información antes de tu viaje."
      : p.cuerpo
    : p.cuerpo;
  const imageUrl = isAssignment ? getPublicImageUrl(d.vehiculo_imagen_url) : "";
  const vehicleImage = imageUrl
    ? `<div style="margin:18px 0;padding:12px;border:1px solid #e5e7eb;border-radius:12px;text-align:center;">
         <img src="${escapeHtml(imageUrl)}" alt="Vehículo asignado a la reserva ${escapeHtml(String(d.id))}" style="display:block;width:100%;max-width:420px;max-height:240px;object-fit:cover;margin:0 auto;border-radius:8px;">
         <p style="margin:8px 0 0;color:#6b7280;font-size:11px;">Foto del vehículo asignado</p>
       </div>`
    : isAssignment
      ? `<p style="margin:16px 0;color:#64748b;font-size:12px;">No hay una foto disponible de la unidad. Verifica la placa y el modelo indicados.</p>`
      : "";
  const webUrl = getWebBaseUrl();
  const action = isAssignment
    ? `<p style="margin:18px 0;text-align:center;">
         <a href="${escapeHtml(`${webUrl}/cliente/historial`)}" style="display:inline-block;padding:12px 18px;border-radius:8px;background:#E31E24;color:#ffffff;font-size:13px;font-weight:bold;text-decoration:none;">Ver reserva y contactar al conductor</a>
       </p>`
    : "";
  return `
  <div style="max-width:520px;margin:0 auto;font-family:Arial,Helvetica,sans-serif;color:#111827;">
    <div style="background:#0b0f1a;padding:24px;border-radius:16px 16px 0 0;text-align:center;">
      <span style="color:#E31E24;font-size:22px;font-weight:800;font-style:italic;letter-spacing:-1px;">TURESMA S.A</span>
      <div style="color:#9ca3af;font-size:10px;letter-spacing:3px;margin-top:2px;">TRANSPORTE TURÍSTICO</div>
    </div>
    <div style="border:1px solid #e5e7eb;border-top:none;border-radius:0 0 16px 16px;padding:28px;">
      <h2 style="margin:0 0 8px;font-size:20px;">${escapeHtml(title)}</h2>
      <p style="margin:0 0 18px;color:#374151;font-size:14px;line-height:1.5;">Hola ${escapeHtml(String(d.cliente_nombre || "cliente"))}, ${body}</p>
      <table style="width:100%;border-collapse:collapse;border-top:1px solid #f3f4f6;">
        ${fila("Reserva", "#" + d.id)}
        ${fila("Origen", d.origen)}
        ${fila("Destino", d.destino)}
        ${fila("Fecha", fmtFecha(d.fecha_reserva))}
        ${fila("Vehículo", d.vehiculo_placa ? `${d.vehiculo_placa}${d.vehiculo_modelo ? " · " + d.vehiculo_modelo : ""}` : "")}
        ${fila("Conductor", d.conductor_nombre)}
        ${fila("Total", d.total != null ? "$" + Number(d.total).toFixed(2) : "")}
      </table>
      ${vehicleImage}
      ${action}
      ${PIE_HTML}
    </div>
  </div>`;
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
    const p = PLANTILLAS[tipo];
    if (!p) return;
    const vehicleDetails = [d.vehiculo_placa, d.vehiculo_modelo, d.conductor_nombre].filter(Boolean).join(" · ");
    const inAppMessage = tipo === "conductor_asignado"
      ? `${isReassignment ? "🔄 Actualizamos la asignación" : "🚐 Turesma asignó los recursos"} de tu reserva #${reservaId}${vehicleDetails ? `: ${vehicleDetails}` : ""}. Consulta los detalles y contacta al conductor desde tu portal.`
      : p.inApp.replace("{id}", String(reservaId));

    // 1) Notificación in-app (campanita del cliente)
    await crearNotificacion(senderId, d.usuario_id, inAppMessage, reservaId, "reserva", reservaId);

    // 2) Correo (si el cliente tiene email y el SMTP está configurado).
    //    Cuando la reserva queda CONFIRMADA, se adjunta el PDF de la proforma.
    if (d.cliente_email) {
      const subject = tipo === "conductor_asignado" && isReassignment
        ? "Actualizamos el vehículo y conductor de tu viaje"
        : p.asunto;
      const assignmentText = tipo === "conductor_asignado"
        ? `\nVehículo: ${[d.vehiculo_placa, d.vehiculo_modelo].filter(Boolean).join(" · ") || "Por confirmar"}\nConductor: ${d.conductor_nombre || "Por confirmar"}\nConsulta tu reserva y contacta al conductor: ${getWebBaseUrl()}/cliente/historial`
        : "";
      let attachments: any[] | undefined;
      if (tipo === "confirmada") {
        try {
          const { getCotizacionIdDeReserva, buildProformaData, generarProformaPDF } = require("./proforma");
          const cotId = await getCotizacionIdDeReserva(reservaId);
          if (cotId) {
            const prof = await buildProformaData(cotId);
            if (prof) {
              const pdf = await generarProformaPDF(prof);
              attachments = [{ filename: `Proforma-${prof.numero}.pdf`, content: pdf }];
            }
          }
        } catch (err: any) {
          console.error("No se pudo adjuntar la proforma:", err?.message || err);
        }
      }
      await enviarCorreo({
        to: d.cliente_email,
        subject,
        html: construirHtml(tipo, d, isReassignment),
        text: `${inAppMessage}${assignmentText}${PIE_TEXTO}`,
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
              u.nombre AS cliente_nombre, u.email AS cliente_email,
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
    const unitLabel = `requerimiento #${operation.requerimiento_id}, grupo ${operation.grupo_numero}, unidad ${operation.unidad_numero}`;
    const vehicleLabel = [operation.vehiculo_placa, operation.vehiculo_modelo].filter(Boolean).join(" · ");
    const message = event === "asignada"
      ? `Tu ${unitLabel} ya tiene recursos asignados${vehicleLabel ? `: ${vehicleLabel}` : ""}${operation.conductor_nombre ? ` · ${operation.conductor_nombre}` : ""}. Revisa la reserva #${operation.reserva_id} en tu portal.`
      : event === "en_curso"
        ? `El conductor inició la ${unitLabel} de tu reserva #${operation.reserva_id}.`
        : `La ${unitLabel} de tu reserva #${operation.reserva_id} fue completada.`;

    await crearNotificacion(senderId, operation.usuario_id, message, operation.reserva_id, "reserva", operation.reserva_id);
    if (operation.conductor_usuario_id) {
      await crearNotificacion(
        senderId,
        operation.conductor_usuario_id,
        `Tienes la ${unitLabel} asignada para ${operation.origen} → ${operation.destino}.`,
        operation.reserva_id,
        "reserva",
        operation.reserva_id
      );
    }

    if (operation.cliente_email) {
      const imageUrl = getPublicImageUrl(operation.vehiculo_imagen_url);
      const image = imageUrl
        ? `<p style="text-align:center"><img src="${escapeHtml(imageUrl)}" alt="Vehículo asignado" style="max-width:100%;max-height:240px;border-radius:8px"></p>`
        : "";
      await enviarCorreo({
        to: operation.cliente_email,
        subject: event === "asignada" ? "Unidad de tu servicio personalizado asignada" : "Actualización de tu servicio personalizado",
        html: `<div style="font-family:Arial,sans-serif;color:#111827;max-width:560px;margin:auto"><h2>Turesma · Actualización del servicio</h2><p>Hola ${escapeHtml(String(operation.cliente_nombre || "cliente"))},</p><p>${escapeHtml(message)}</p><p><b>Ruta:</b> ${escapeHtml(String(operation.origen))} → ${escapeHtml(String(operation.destino))}</p><p><b>Fecha:</b> ${escapeHtml(fmtFecha(operation.fecha_programada))}</p><p><b>Vehículo:</b> ${escapeHtml(vehicleLabel || "Por confirmar")}</p><p><b>Conductor:</b> ${escapeHtml(String(operation.conductor_nombre || "Por confirmar"))}</p>${image}<p><a href="${escapeHtml(`${getWebBaseUrl()}/cliente/historial`)}">Ver estado de la reserva</a></p>${PIE_HTML}</div>`,
        text: `${message}\nRuta: ${operation.origen} → ${operation.destino}\nVehículo: ${vehicleLabel || "Por confirmar"}\nConductor: ${operation.conductor_nombre || "Por confirmar"}\n${getWebBaseUrl()}/cliente/historial${PIE_TEXTO}`,
      });
    }
  } catch (error: any) {
    console.error(`Error notificando la operación personalizada #${operationId}:`, error?.message || error);
  }
};

// El cliente reprogramó su reserva: correo de confirmación al cliente + aviso
// in-app al admin y al conductor con la nueva fecha/hora. Todo best-effort.
const notificarReprogramacion = async (reservaId: number, senderId: number | null | undefined) => {
  try {
    const r = await pool.query(
      `SELECT r.id, r.origen, r.destino, r.fecha_reserva, r.fecha_regreso, r.hora_regreso, r.usuario_id, r.conductor_id,
              u.nombre AS cliente_nombre, u.email AS cliente_email,
              co.hora_salida
       FROM reservas r
       JOIN usuarios u ON u.id = r.usuario_id
       LEFT JOIN cotizaciones co ON co.reserva_id = r.id
       WHERE r.id = $1 LIMIT 1`,
      [reservaId]
    );
    if (r.rowCount === 0) return;
    const d = r.rows[0];
    const cuando = `${fmtFecha(d.fecha_reserva)}${d.hora_salida ? " · " + d.hora_salida : ""}${d.fecha_regreso ? ` · Regreso: ${fmtFecha(d.fecha_regreso)}${d.hora_regreso ? " · " + d.hora_regreso : ""}` : ""}`;

    // 1) Correo al cliente (confirmando su cambio)
    if (d.cliente_email) {
      const html = `
        <div style="max-width:520px;margin:0 auto;font-family:Arial,Helvetica,sans-serif;color:#111827;">
          <div style="background:#0b0f1a;padding:24px;border-radius:16px 16px 0 0;text-align:center;">
            <span style="color:#E31E24;font-size:22px;font-weight:800;font-style:italic;letter-spacing:-1px;">TURESMA S.A</span>
            <div style="color:#9ca3af;font-size:10px;letter-spacing:3px;margin-top:2px;">TRANSPORTE TURÍSTICO</div>
          </div>
          <div style="border:1px solid #e5e7eb;border-top:none;border-radius:0 0 16px 16px;padding:28px;">
            <h2 style="margin:0 0 12px;font-size:20px;">Cambio en tu reserva 🗓️</h2>
            <p style="margin:0 0 12px;color:#374151;font-size:14px;line-height:1.6;">Hola ${d.cliente_nombre || "cliente"}, registramos el cambio en tu reserva <b>#${reservaId}</b> (${d.origen} → ${d.destino}).</p>
            <p style="margin:0 0 12px;color:#374151;font-size:14px;line-height:1.6;">Tu nueva <b>fecha y hora de salida</b> es:</p>
            <p style="margin:0 0 12px;font-size:18px;font-weight:800;color:#0b0f1a;">${cuando}</p>
            <p style="margin:0;color:#374151;font-size:14px;line-height:1.6;">Ya avisamos al conductor y al equipo de Turesma. ¡Buen viaje! 🚐</p>
            ${PIE_HTML}
          </div>
        </div>`;
      await enviarCorreo({
        to: d.cliente_email,
        subject: "Cambiaste la fecha/hora de tu reserva — Turesma",
        html,
        text: `Cambiaste tu reserva #${reservaId}. Nueva salida: ${cuando}.` + PIE_TEXTO,
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

module.exports = { notificarClienteReserva, notificarClienteOperacion, notificarReprogramacion };
