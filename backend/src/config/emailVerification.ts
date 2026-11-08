export {};

const crypto = require("crypto");
const pool = require("./db");
const { enviarCorreo } = require("./mailer");

const VERIFICATION_TTL_HOURS = 24;

const hashToken = (token: string) => crypto.createHash("sha256").update(token).digest("hex");

const getVerificationUrl = (token: string) => {
  const webUrl = String(process.env.WEB_URL || "http://localhost:3000").replace(/\/+$/, "");
  return `${webUrl}/verificar-correo?token=${encodeURIComponent(token)}`;
};

const createEmailVerificationToken = () => {
  const token = crypto.randomBytes(32).toString("hex");
  return {
    token,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + VERIFICATION_TTL_HOURS * 60 * 60 * 1000),
  };
};

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
}[character] || character));

const sendEmailVerification = async (email: string, nombre: string, token: string) => {
  const url = getVerificationUrl(token);
  const safeName = escapeHtml(nombre || "usuario");
  return enviarCorreo({
    to: email,
    subject: "Verifica tu correo electrónico - Turesma",
    text: `Hola ${nombre || "usuario"}, confirma tu correo abriendo este enlace: ${url}. El enlace expira en ${VERIFICATION_TTL_HOURS} horas.`,
    html: `
      <div style="font-family:Arial,sans-serif;line-height:1.6;color:#111827;max-width:560px;margin:auto">
        <h2>Verifica tu correo electrónico</h2>
        <p>Hola ${safeName}, confirma tu correo electrónico para activar tu cuenta de Turesma.</p>
        <p><a href="${url}" style="display:inline-block;background:#E31E24;color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none;font-weight:bold">Verificar mi correo</a></p>
        <p style="font-size:12px;color:#6b7280">Este enlace expira en ${VERIFICATION_TTL_HOURS} horas.</p>
      </div>
    `,
  });
};

const createEmailVerification = async (userId: number, email: string, nombre: string) => {
  const { token, tokenHash, expiresAt } = createEmailVerificationToken();
  await pool.query(
    `UPDATE usuarios
     SET email_verification_token_hash = $1,
         email_verification_expires_at = $2,
         email_verified_at = NULL,
         pending_email = NULL
     WHERE id = $3`,
    [tokenHash, expiresAt, userId]
  );

  return sendEmailVerification(email, nombre, token);
};

const verifyEmailToken = async (token: string) => {
  if (!token || token.length < 32) return false;
  const result = await pool.query(
    `UPDATE usuarios
     SET email = COALESCE(pending_email, email),
         pending_email = NULL,
         email_verified_at = NOW(),
         email_verification_token_hash = NULL,
         email_verification_expires_at = NULL
     WHERE email_verification_token_hash = $1
       AND email_verification_expires_at > NOW()
     RETURNING id, email`,
    [hashToken(token)]
  );
  return result.rowCount > 0 ? result.rows[0] : false;
};

module.exports = {
  createEmailVerification,
  createEmailVerificationToken,
  sendEmailVerification,
  verifyEmailToken,
};
