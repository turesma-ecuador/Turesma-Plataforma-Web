export {};

const crypto = require("crypto");
const pool = require("./db");
const { enviarCorreo } = require("./mailer");
const { escapeHtml, getWebBaseUrl, getBrandedEmailLogoAttachment, renderBrandedEmail } = require("./emailTemplate");

const VERIFICATION_TTL_HOURS = 24;

const hashToken = (token: string) => crypto.createHash("sha256").update(token).digest("hex");

const getVerificationUrl = (token: string) => {
  return `${getWebBaseUrl()}/verificar-correo?token=${encodeURIComponent(token)}`;
};

const createEmailVerificationToken = () => {
  const token = crypto.randomBytes(32).toString("hex");
  return {
    token,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + VERIFICATION_TTL_HOURS * 60 * 60 * 1000),
  };
};

const sendEmailVerification = async (email: string, nombre: string, token: string) => {
  const url = getVerificationUrl(token);
  const safeName = escapeHtml(nombre || "usuario");
  return enviarCorreo({
    to: email,
    subject: "Confirma tu correo electrónico | Turesma",
    text: `Hola ${nombre || "usuario"}:\n\nGracias por registrarte en Turesma. Para activar tu cuenta, confirma que esta dirección de correo te pertenece:\n\n${url}\n\nPor seguridad, el enlace es válido durante ${VERIFICATION_TTL_HOURS} horas. Si no solicitaste esta cuenta, puedes ignorar este mensaje.`,
    html: renderBrandedEmail({
      preheader: "Confirma tu correo para activar tu cuenta de Turesma.",
      title: "Confirma tu correo electrónico",
      bodyHtml: `<p style="margin:0 0 14px">Hola <strong>${safeName}</strong>:</p>
        <p style="margin:0">Gracias por registrarte en Turesma. Para activar tu cuenta y comenzar a usar nuestros servicios, confirma que esta dirección de correo te pertenece.</p>`,
      actionLabel: "Confirmar mi correo",
      actionUrl: url,
      notice: `Por seguridad, este enlace es válido durante ${VERIFICATION_TTL_HOURS} horas. Si no solicitaste esta cuenta, puedes ignorar este mensaje.`,
    }),
    attachments: [getBrandedEmailLogoAttachment()],
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
