export {};

const nodemailer = require("nodemailer");

// Construye el transporte SMTP a partir de las variables de entorno.
// Devuelve null si el correo no está configurado (así el sistema sigue
// funcionando sin correo, solo con notificaciones in-app).
const getMailTransporter = () => {
  const service = process.env.SMTP_SERVICE;
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const secureByEnv = String(process.env.SMTP_SECURE || "").toLowerCase() === "true";
  const requireTls = String(process.env.SMTP_REQUIRE_TLS || "").toLowerCase() === "true";
  const rejectUnauthorized = String(process.env.SMTP_REJECT_UNAUTHORIZED || "true").toLowerCase() === "true";

  if ((!service && !host) || !user || !pass) {
    return null;
  }

  const transportConfig: any = {
    auth: { user, pass },
    secure: secureByEnv || port === 465,
    requireTLS: requireTls,
    tls: { rejectUnauthorized },
  };

  if (service) {
    return nodemailer.createTransport({ ...transportConfig, service });
  }
  return nodemailer.createTransport({ ...transportConfig, host, port });
};

// Envía un correo de forma "best-effort": nunca lanza excepción hacia quien lo
// llama. Si el correo no está configurado o falla, solo lo registra y devuelve
// { sent: false } para que la operación principal (aceptar/confirmar/…) no se
// caiga por un problema de correo.
const enviarCorreo = async ({ to, subject, html, text, attachments }: { to: string; subject: string; html?: string; text?: string; attachments?: any[] }) => {
  try {
    const transporter = getMailTransporter();
    if (!transporter || !to) {
      const missing = [
        !process.env.SMTP_SERVICE && !process.env.SMTP_HOST ? "SMTP_SERVICE or SMTP_HOST" : null,
        !process.env.SMTP_USER ? "SMTP_USER" : null,
        !process.env.SMTP_PASS ? "SMTP_PASS" : null,
        !to ? "recipient" : null,
      ].filter(Boolean);
      console.error(`Email not sent; missing configuration: ${missing.join(", ") || "transporter unavailable"}`);
      return { sent: false, reason: "not_configured" };
    }

    await transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to,
      subject,
      text: text || undefined,
      html: html || undefined,
      attachments: attachments && attachments.length ? attachments : undefined,
    });
    return { sent: true };
  } catch (e: any) {
    const code = typeof e?.code === "string" ? e.code : undefined;
    const command = typeof e?.command === "string" ? e.command : undefined;
    console.error("Error enviando correo:", { code, command, message: e?.message || String(e) });
    return { sent: false, reason: "error", code };
  }
};

module.exports = { getMailTransporter, enviarCorreo };
