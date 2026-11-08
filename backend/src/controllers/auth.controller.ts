export {};

const pool = require("../config/db");
const bcrypt = require("bcrypt");
const crypto = require("crypto");
const nodemailer = require("nodemailer");
const { normalizeRole } = require("../config/catalogoHelpers");
const { generateToken } = require("../middleware/auth.middleware");
const { createEmailVerification } = require("../config/emailVerification");

const PIN_TTL_MINUTES = Number(process.env.PASSWORD_RESET_PIN_TTL_MINUTES || 10);

const hashPin = (pin) => {
  return crypto.createHash("sha256").update(String(pin)).digest("hex");
};

const generatePin = () => String(Math.floor(100000 + Math.random() * 900000));

const getMissingMailConfig = () => {
  const missing = [];
  if (!process.env.SMTP_SERVICE && !process.env.SMTP_HOST) missing.push("SMTP_SERVICE|SMTP_HOST");
  if (!process.env.SMTP_USER) missing.push("SMTP_USER");
  if (!process.env.SMTP_PASS) missing.push("SMTP_PASS");
  if (!process.env.SMTP_FROM) missing.push("SMTP_FROM");
  return missing;
};

const isMailConfigured = () => {
  return getMissingMailConfig().length === 0;
};

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

  const transportConfig = {
    auth: { user, pass },
    secure: secureByEnv || port === 465,
    requireTLS: requireTls,
    tls: {
      rejectUnauthorized,
    },
  };

  if (service) {
    return nodemailer.createTransport({
      ...transportConfig,
      service,
    });
  }

  return nodemailer.createTransport({
    ...transportConfig,
    host,
    port,
  });
};

const sendResetPinEmail = async ({ to, pin, nombre }) => {
  const transporter = getMailTransporter();
  const ttlMinutes = Number.isFinite(PIN_TTL_MINUTES) && PIN_TTL_MINUTES > 0 ? PIN_TTL_MINUTES : 10;

  if (!transporter) {
    throw new Error("SMTP_NOT_CONFIGURED");
  }

  const info = await transporter.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to,
    subject: "Recuperación de contraseña - Turesma",
    text: `Hola ${nombre || "usuario"}, tu PIN de recuperación es ${pin}. Expira en ${ttlMinutes} minutos.`,
    html: `
      <div style="font-family: Arial, sans-serif; line-height:1.5; color:#111827;">
        <h2>Recuperación de contraseña</h2>
        <p>Hola ${nombre || "usuario"},</p>
        <p>Tu PIN de recuperación es:</p>
        <p style="font-size:24px; font-weight:700; letter-spacing:3px;">${pin}</p>
        <p>Este PIN expira en ${ttlMinutes} minutos.</p>
      </div>
    `,
  });

  console.log(`[RECUPERAR_CLAVE] Correo enviado a ${to}. messageId=${info.messageId || "N/A"}`);
};

const getSmtpErrorMessage = (error) => {
  const code = String(error?.code || "").toUpperCase();
  const message = String(error?.message || "").toLowerCase();

  if (code === "EAUTH" || message.includes("badcredentials")) {
    return "No se pudo autenticar con Gmail SMTP. Usa una App Password de Gmail en SMTP_PASS (no tu contraseña normal).";
  }

  if (code === "ETIMEDOUT" || code === "ESOCKET" || code === "ECONNECTION" || code === "ECONNREFUSED") {
    return "No se pudo conectar al servidor SMTP. Verifica SMTP_HOST/SMTP_PORT o tu conexión a internet.";
  }

  return "No se pudo enviar el correo de recuperación. Revisa la configuración SMTP.";
};

const register = async (req, res) => {
  const nombreRaw = typeof req.body.nombre === "string"
    ? req.body.nombre
    : typeof req.body.name === "string"
      ? req.body.name
      : "";
  const nombre = String(nombreRaw || "").trim();
  const email = typeof req.body.email === "string" ? req.body.email.trim().toLowerCase() : "";
  const telefono = typeof req.body.telefono === "string" ? req.body.telefono.trim() : "";
  const cedula = typeof req.body.cedula === "string" ? req.body.cedula.trim() : "";
  const password = typeof req.body.password === "string" ? req.body.password : "";
  const fotoUrl = typeof req.body.foto_url === "string" ? req.body.foto_url.trim() : null;

  if (!nombre || !email || !telefono || !password || !cedula) {
    return res.status(400).json({ error: "Debes enviar nombre, email, telefono, cedula y password" });
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ error: "Debes enviar un email valido" });
  }

  if (password.length < 6) {
    return res.status(400).json({ error: "La contrasena debe tener al menos 6 caracteres" });
  }
  if (!/^\d{10}$/.test(cedula)) {
    return res.status(400).json({ error: "La cédula debe tener 10 dígitos" });
  }

  try {
    const passwordHash = await bcrypt.hash(password, 10);
    const rol = (await normalizeRole("cliente")) || "cliente";

    const result = await pool.query(
      `INSERT INTO usuarios (nombre, email, telefono, cedula, password_hash, rol, imagen_url, activo, estado_verificacion)
       VALUES ($1, $2, $3, $4, $5, $6, $7, true, 'no_verificado')
       RETURNING id, nombre, email, telefono, cedula, rol, imagen_url, activo, creado_en`,
      [nombre, email, telefono, cedula, passwordHash, rol, fotoUrl]
    );

    const newUser = result.rows[0];
    try {
      await createEmailVerification(newUser.id, newUser.email, newUser.nombre);
    } catch (mailError) {
      console.error("Error enviando verificación por correo:", mailError);
    }

    return res.status(201).json({
      message: "Cuenta creada correctamente. Verifica tu correo antes de iniciar sesión.",
      user: newUser,
    });
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({ error: "El correo ya está registrado" });
    }

    console.error("Error registrando usuario:", error);
    return res.status(500).json({ error: "Error interno del servidor" });
  }
};

const login = async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res
      .status(400)
      .json({ error: "Debes enviar email y password para iniciar sesión" });
  }

  try {
    const result = await pool.query(
      `SELECT id, nombre, email, rol, imagen_url, password_hash,
              activo, email_verified_at, pending_email, session_version,
              COALESCE(estado_verificacion, 'no_verificado') AS estado_verificacion
       FROM usuarios
       WHERE LOWER(email) = LOWER($1)
       LIMIT 1`,
      [email]
    );

    if (result.rowCount === 0) {
      return res.status(401).json({ error: "Credenciales inválidas" });
    }

    const user = result.rows[0];
    const isBcryptHash =
      typeof user.password_hash === "string" && user.password_hash.startsWith("$2");
    const isPasswordValid = isBcryptHash
      ? await bcrypt.compare(password, user.password_hash)
      : password === user.password_hash;

    if (!isPasswordValid) {
      return res.status(401).json({ error: "Credenciales inválidas" });
    }

    const normalizedRole = (await normalizeRole(user.rol)) || user.rol;
    if (normalizedRole === "cliente" && user.pending_email) {
      return res.status(403).json({
        error: "Se solicitó un cambio de correo para tu cuenta. Verifica el enlace enviado al nuevo correo antes de volver a iniciar sesión.",
        code: "EMAIL_CHANGE_PENDING",
      });
    }
    if (normalizedRole === "cliente" && !user.email_verified_at) {
      return res.status(403).json({
        error: "Debes verificar tu correo electrónico antes de iniciar sesión. Revisa tu bandeja de entrada.",
        code: "EMAIL_NOT_VERIFIED",
      });
    }

    if (user.activo === false) {
      return res.status(403).json({ error: "Tu cuenta está desactivada. Contacta al administrador." });
    }

    if (!isBcryptHash) {
      const hashedPassword = await bcrypt.hash(password, 10);
      await pool.query("UPDATE usuarios SET password_hash = $1 WHERE id = $2", [
        hashedPassword,
        user.id,
      ]);
    }

    const safeUser = {
      id: user.id,
      nombre: user.nombre,
      email: user.email,
      rol: normalizedRole,
      imagen_url: user.imagen_url || null,
    };
    const token = generateToken({
      id: user.id,
      email: user.email,
      rol: normalizedRole,
      session_version: Number(user.session_version || 0),
    });
    const message = `Bienvenido ${normalizedRole}`;

    return res.status(200).json({
      message,
      user: safeUser,
      token,
    });
  } catch (error) {
    console.error("Error en login:", error);
    return res.status(500).json({ error: "Error interno del servidor" });
  }
};

const forgotPassword = async (req, res) => {
  const email = typeof req.body.email === "string" ? req.body.email.trim().toLowerCase() : "";
  let resetId = null;

  if (!email) {
    return res.status(400).json({ error: "Debes enviar un email válido" });
  }

  try {
    const userResult = await pool.query(
      "SELECT id, nombre, email, activo FROM usuarios WHERE LOWER(email) = $1 LIMIT 1",
      [email]
    );

    if (userResult.rowCount === 0 || userResult.rows[0].activo === false) {
      return res.status(200).json({
        message: "Si el correo está registrado, recibirás un PIN de recuperación.",
      });
    }

    if (!isMailConfigured()) {
      const missing = getMissingMailConfig();
      return res.status(500).json({
        error: `El servicio de correo no está configurado. Faltan: ${missing.join(", ")}`,
      });
    }

    const user = userResult.rows[0];
    const pin = generatePin();
    const pinHash = hashPin(pin);
    const ttlMinutes = Number.isFinite(PIN_TTL_MINUTES) && PIN_TTL_MINUTES > 0 ? PIN_TTL_MINUTES : 10;

    const insertResult = await pool.query(
      `INSERT INTO password_resets (usuario_id, email, pin_hash, expires_at)
       VALUES ($1, $2, $3, NOW() + ($4::text || ' minutes')::interval)
       RETURNING id`,
      [user.id, user.email.toLowerCase(), pinHash, ttlMinutes]
    );

    resetId = insertResult.rows?.[0]?.id || null;

    await sendResetPinEmail({ to: user.email, pin, nombre: user.nombre });

    return res.status(200).json({
      message: "Si el correo está registrado, recibirás un PIN de recuperación.",
    });
  } catch (error) {
    if (resetId) {
      await pool.query("DELETE FROM password_resets WHERE id = $1", [resetId]).catch(() => null);
    }

    if (String(error.message || "") === "SMTP_NOT_CONFIGURED") {
      const missing = getMissingMailConfig();
      return res.status(500).json({
        error: `El servicio de correo no está configurado. Faltan: ${missing.join(", ")}`,
      });
    }

    const smtpErrorMessage = getSmtpErrorMessage(error);
    if (String(error?.code || "").toUpperCase().startsWith("E")) {
      return res.status(502).json({ error: smtpErrorMessage });
    }

    console.error("Error solicitando recuperación de contraseña:", error);
    return res.status(500).json({ error: "Error interno del servidor" });
  }
};

const resetPassword = async (req, res) => {
  const email = typeof req.body.email === "string" ? req.body.email.trim().toLowerCase() : "";
  const pin = typeof req.body.pin === "string" ? req.body.pin.trim() : "";
  const newPassword = typeof req.body.new_password === "string" ? req.body.new_password : "";

  if (!email || !pin || !newPassword) {
    return res.status(400).json({ error: "Debes enviar email, pin y new_password" });
  }

  if (newPassword.length < 6) {
    return res.status(400).json({ error: "La nueva contraseña debe tener al menos 6 caracteres" });
  }

  try {
    const resetResult = await pool.query(
      `SELECT id, usuario_id, pin_hash, expires_at, attempts, used_at
       FROM password_resets
       WHERE LOWER(email) = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [email]
    );

    if (resetResult.rowCount === 0) {
      return res.status(400).json({ error: "PIN inválido o expirado" });
    }

    const reset = resetResult.rows[0];

    if (reset.used_at) {
      return res.status(400).json({ error: "Este PIN ya fue utilizado" });
    }

    const expiresAt = new Date(reset.expires_at).getTime();
    if (Number.isFinite(expiresAt) && Date.now() > expiresAt) {
      return res.status(400).json({ error: "PIN inválido o expirado" });
    }

    if (Number(reset.attempts || 0) >= 5) {
      return res.status(429).json({ error: "Demasiados intentos. Solicita un nuevo PIN" });
    }

    const isValidPin = hashPin(pin) === reset.pin_hash;

    if (!isValidPin) {
      await pool.query("UPDATE password_resets SET attempts = attempts + 1 WHERE id = $1", [reset.id]);
      return res.status(400).json({ error: "PIN inválido o expirado" });
    }

    const newHash = await bcrypt.hash(newPassword, 10);

    await pool.query("UPDATE usuarios SET password_hash = $1 WHERE id = $2", [newHash, reset.usuario_id]);
    await pool.query("UPDATE password_resets SET used_at = NOW() WHERE id = $1", [reset.id]);

    return res.status(200).json({ message: "Contraseña actualizada correctamente" });
  } catch (error) {
    console.error("Error restableciendo contraseña:", error);
    return res.status(500).json({ error: "Error interno del servidor" });
  }
};

const updateMe = async (req: any, res: any) => {
  const userId = req.user?.id;
  if (!userId) {
    return res.status(401).json({ error: "No autenticado" });
  }

  const nombre = typeof req.body.nombre === "string" ? req.body.nombre.trim() : undefined;
  const telefono = typeof req.body.telefono === "string" ? req.body.telefono.trim() : undefined;
  const imagenUrl = typeof req.body.imagen_url === "string" ? req.body.imagen_url.trim() : undefined;
  const password = typeof req.body.password === "string" ? req.body.password : undefined;

  try {
    const updates: string[] = [];
    const values: any[] = [];
    let i = 1;

    if (nombre !== undefined && nombre.length > 0) { updates.push(`nombre = $${i++}`); values.push(nombre); }
    if (telefono !== undefined) { updates.push(`telefono = $${i++}`); values.push(telefono || null); }
    if (imagenUrl !== undefined) { updates.push(`imagen_url = $${i++}`); values.push(imagenUrl || null); }

    if (password !== undefined && password.length > 0) {
      if (password.length < 6) {
        return res.status(400).json({ error: "La contraseña debe tener al menos 6 caracteres" });
      }
      const hash = await bcrypt.hash(password, 10);
      updates.push(`password_hash = $${i++}`);
      values.push(hash);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: "No hay cambios para guardar" });
    }

    values.push(userId);
    const result = await pool.query(
      `UPDATE usuarios SET ${updates.join(", ")} WHERE id = $${i}
       RETURNING id, nombre, email, rol, imagen_url, telefono`,
      values
    );

    return res.status(200).json({ message: "Perfil actualizado correctamente", user: result.rows[0] });
  } catch (error) {
    console.error("Error actualizando perfil:", error);
    return res.status(500).json({ error: "Error interno del servidor" });
  }
};

const getMe = async (req: any, res: any) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "No autenticado" });
    }

    const result = await pool.query(
      `SELECT id, nombre, email, pending_email, rol, telefono, imagen_url, activo, creado_en
       FROM usuarios
       WHERE id = $1
         AND activo = true
       LIMIT 1`,
      [userId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Usuario no encontrado" });
    }

    return res.status(200).json({ user: result.rows[0] });
  } catch (error) {
    console.error("Error en getMe:", error);
    return res.status(500).json({ error: "Error interno del servidor" });
  }
};

module.exports = {
  register,
  login,
  forgotPassword,
  resetPassword,
  getMe,
  updateMe,
};
