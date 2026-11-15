export {};

const { enviarCorreo } = require("./mailer");
const { escapeHtml, getBrandedEmailLogoAttachment, renderBrandedEmail } = require("./emailTemplate");

const CONTACTO_EMAIL = "turesmasa@hotmail.com";

// Correo de bienvenida cuando un cliente crea su cuenta. Best-effort.
const enviarCorreoBienvenida = async ({ email, nombre }: { email?: string | null; nombre?: string | null }) => {
  if (!email) return;
  const html = renderBrandedEmail({
    preheader: "Tu cuenta de Turesma fue creada correctamente.",
    eyebrow: "BIENVENIDO A TURESMA",
    title: "¡Bienvenido a Turesma!",
    bodyHtml: `
      <p style="margin:0 0 12px">Hola <strong>${escapeHtml(nombre || "cliente")}</strong>, tu cuenta en Turesma fue creada correctamente. 🎉</p>
      <p style="margin:0 0 12px">Ya puedes iniciar sesión y solicitar cotizaciones para tus viajes. Para reservar, primero confirma tu correo electrónico y registra tu número de cédula.</p>
      <p style="margin:0">¡Gracias por unirte!</p>`,
    contactEmail: CONTACTO_EMAIL,
  });
  await enviarCorreo({
    to: email,
    subject: "Tu cuenta en Turesma fue creada ✅",
    html,
    text: `Hola ${nombre || "cliente"}, tu cuenta en Turesma fue creada correctamente. Confirma tu correo electrónico para verificar tu identidad.\n\n— Este mensaje se envió de forma automática. Para más información comunícate al correo turesmasa@hotmail.com.`,
    attachments: [getBrandedEmailLogoAttachment()],
  });
};

// Correo cuando el admin aprueba la verificación de identidad del cliente. Best-effort.
const enviarCorreoVerificacionAprobada = async ({ email, nombre }: { email?: string | null; nombre?: string | null }) => {
  if (!email) return;
  const html = renderBrandedEmail({
    preheader: "Tu identidad fue verificada en Turesma.",
    eyebrow: "VERIFICACIÓN DE IDENTIDAD",
    title: "Identidad verificada ✅",
    bodyHtml: `
      <p style="margin:0 0 12px">Hola <strong>${escapeHtml(nombre || "cliente")}</strong>, ¡buenas noticias! Tu identidad fue verificada por nuestro equipo.</p>
      <p style="margin:0 0 16px">Ya puedes solicitar y confirmar tus servicios en Turesma sin restricciones. 🚗</p>
      <p style="margin:0;padding:12px 14px;border:1px solid #bbf7d0;border-radius:8px;background-color:#f0fdf4;color:#166534;font-weight:bold">Tu cuenta está habilitada para reservar.</p>`,
    contactEmail: CONTACTO_EMAIL,
  });
  await enviarCorreo({
    to: email,
    subject: "Tu identidad fue verificada en Turesma ✅",
    html,
    text: `Hola ${nombre || "cliente"}, tu identidad fue verificada. Ya puedes solicitar tus servicios en Turesma.\n\n— Este mensaje se envió de forma automática. Para más información comunícate al correo turesmasa@hotmail.com.`,
    attachments: [getBrandedEmailLogoAttachment()],
  });
};

module.exports = { enviarCorreoBienvenida, enviarCorreoVerificacionAprobada };
