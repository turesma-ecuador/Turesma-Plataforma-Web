export {};

const pool = require("../../config/db");
const bcrypt = require("bcrypt");
const { enviarCorreo } = require("../../config/mailer");
const { normalizeRole } = require("../../config/catalogoHelpers");
const {
  createEmailVerification,
  createEmailVerificationToken,
  sendEmailVerification,
} = require("../../config/emailVerification");

const parsePositiveInt = (value) => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
};

const parseDiasServicio = (value) => {
  if (!Array.isArray(value)) return [0, 1, 2, 3, 4, 5, 6];

  const cleaned = Array.from(
    new Set(
      value
        .map((day) => Number(day))
        .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)
    )
  ).sort((a, b) => a - b);

  return cleaned.length ? cleaned : [0, 1, 2, 3, 4, 5, 6];
};

const crearUsuarioAdmin = async (req, res) => {
  const {
    nombre,
    email,
    password,
    rol,
    edad,
    capacidad_pasajeros,
    placa,
    telefono,
    cedula,
    imagen_url,
    tipo_vehiculo,
    modelo_vehiculo,
    color_vehiculo,
    imagen_vehiculo_url,
    descripcion_vehiculo,
    dias_servicio,
  } = req.body;

  if (!nombre || !email || !password || !rol || !telefono || !String(telefono).trim()) {
    return res.status(400).json({
      error: "Debes enviar nombre, email, telefono, password y rol",
    });
  }

  const normalizedRole = await normalizeRole(rol);

  if (!normalizedRole) {
    return res.status(400).json({
      error: "Rol inválido. Debe ser admin, cliente, operativo o vehiculo",
    });
  }

  let edadValue = null;
  let capacidadPasajerosValue = null;
  let placaValue = null;
  const telefonoValue = String(telefono).trim();
  const cedulaValue = cedula === undefined || cedula === null ? null : String(cedula).trim();

  if (normalizedRole === "cliente" && (!cedulaValue || !/^\d{10}$/.test(cedulaValue))) {
    return res.status(400).json({ error: "La cédula debe tener 10 dígitos" });
  }

  if (normalizedRole === "vehiculo") {
    const parsedEdad = Number(edad);
    const parsedCapacidad = Number(capacidad_pasajeros);

    if (!Number.isInteger(parsedEdad) || parsedEdad < 18) {
      return res.status(400).json({
        error: "Debes enviar una edad válida (mínimo 18) para usuario vehículo",
      });
    }

    if (!Number.isInteger(parsedCapacidad) || parsedCapacidad <= 0) {
      return res.status(400).json({
        error: "Debes enviar una capacidad de pasajeros válida para usuario vehículo",
      });
    }

    if (!placa || typeof placa !== "string" || placa.trim().length === 0) {
      return res.status(400).json({
        error: "Debes enviar la placa del vehículo para usuario vehículo",
      });
    }

    edadValue = parsedEdad;
    capacidadPasajerosValue = parsedCapacidad;
    placaValue = placa.trim().toUpperCase();
  }

  try {
    const hashedPassword = await bcrypt.hash(password, 10);

    // Verificación explícita para evitar depender solo del constraint de la BD
    const existing = await pool.query("SELECT id FROM usuarios WHERE LOWER(email) = LOWER($1) LIMIT 1", [email]);
    if (existing.rowCount) {
      return res.status(409).json({ error: "El email ya está registrado" });
    }

    const insertResult = await pool.query(
      `INSERT INTO usuarios (nombre, email, password_hash, rol, edad, capacidad_pasajeros, telefono, cedula, imagen_url, activo)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true)
       RETURNING id, nombre, email, rol, edad, capacidad_pasajeros, telefono, cedula, imagen_url, activo, creado_en`,
      [nombre, email, hashedPassword, normalizedRole, edadValue, capacidadPasajerosValue, telefonoValue, cedulaValue, imagen_url || null]
    );

    const createdUser = insertResult.rows[0];

    if (normalizedRole === "vehiculo" && placaValue) {
      try {
        await pool.query(
          `INSERT INTO vehiculos (placa, usuario_id, tipo, modelo, capacidad, color, imagen_url, descripcion, dias_servicio, estado, activo)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, true)`,
          [
            placaValue,
            createdUser.id,
            (tipo_vehiculo && String(tipo_vehiculo).trim()) || "van",
            (modelo_vehiculo && String(modelo_vehiculo).trim()) || ("Vehículo de " + createdUser.nombre),
            capacidadPasajerosValue,
            (color_vehiculo && String(color_vehiculo).trim()) || null,
            (imagen_vehiculo_url && String(imagen_vehiculo_url).trim()) || null,
            (descripcion_vehiculo && String(descripcion_vehiculo).trim()) || null,
            parseDiasServicio(dias_servicio),
            "disponible",
          ]
        );
      } catch (vehicleError) {
        if (vehicleError.code === "23505") {
          return res.status(409).json({
            error: "La placa del vehículo ya está registrada",
          });
        }
        throw vehicleError;
      }
    }

    try {
      await createEmailVerification(createdUser.id, createdUser.email, createdUser.nombre);
    } catch (mailError) {
      console.error("Error enviando verificación por correo al usuario creado por admin:", mailError);
    }

    return res.status(201).json({
      message: "Usuario creado correctamente. Se envió un enlace de verificación al correo indicado.",
      user: createdUser,
    });
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({ error: "El email ya está registrado" });
    }

    console.error("Error creando usuario admin:", error);
    return res.status(500).json({ error: "Error interno del servidor" });
  }
};

const listarUsuariosAdmin = async (req, res) => {
  try {
    const { rol } = req.query;

    let query = `SELECT id, nombre, email, pending_email, email_verified_at, rol, edad, capacidad_pasajeros, telefono, cedula, imagen_url, activo, creado_en FROM usuarios`;
    const params: unknown[] = [];

    if (rol && typeof rol === "string") {
      const normalizedFilterRole = await normalizeRole(rol);
      if (!normalizedFilterRole) {
        return res.status(400).json({ error: "Rol de filtro inválido" });
      }
      query += " WHERE rol = $1";
      params.push(normalizedFilterRole);
    }

    query += " ORDER BY id DESC";

    const result = await pool.query(query, params);
    return res.status(200).json(result.rows);
  } catch (error) {
    console.error("Error listando usuarios:", error);
    return res.status(500).json({ error: "Error interno del servidor" });
  }
};

const editarUsuarioAdmin = async (req, res) => {
  const userId = parsePositiveInt(req.params.id);

  if (!userId) {
    return res.status(400).json({ error: "ID de usuario inválido" });
  }

  try {
    const currentResult = await pool.query(
      "SELECT id, nombre, email, rol, activo, password_hash, imagen_url, cedula FROM usuarios WHERE id = $1 LIMIT 1",
      [userId]
    );

    if (currentResult.rowCount === 0) {
      return res.status(404).json({ error: "Usuario no encontrado" });
    }

    const current = currentResult.rows[0];
    const requestedEmail = typeof req.body.email === "string" ? req.body.email.trim().toLowerCase() : current.email;
    if (requestedEmail !== String(current.email).trim().toLowerCase()) {
      return res.status(400).json({
        error: "El cambio de correo requiere el flujo de recuperación y verificación desde el detalle del cliente.",
      });
    }

    // Campos a actualizar
    const nombre = req.body.nombre || current.nombre;
    const email = current.email;
    const telefono = req.body.telefono !== undefined ? (String(req.body.telefono).trim() || null) : undefined;
    const cedula = req.body.cedula !== undefined ? String(req.body.cedula).trim() : undefined;
    if (cedula !== undefined && cedula && !/^\d{10}$/.test(cedula)) {
      return res.status(400).json({ error: "La cédula debe tener 10 dígitos" });
    }
    let passwordHash = current.password_hash;

    if (req.body.password) {
      passwordHash = await bcrypt.hash(req.body.password, 10);
    }

    const imagenUrl =
      (req.body.imagen_url && String(req.body.imagen_url).trim()) ||
      (req.body.foto_conductor && String(req.body.foto_conductor).trim()) ||
      current.imagen_url || null;

    const result = await pool.query(
      `UPDATE usuarios
       SET nombre = $1,
           email = $2,
           password_hash = $3,
           imagen_url = $4,
           telefono = COALESCE($5, telefono),
           cedula = COALESCE($6, cedula)
       WHERE id = $7
       RETURNING id, nombre, email, rol, telefono, cedula, activo, imagen_url, creado_en`,
      [nombre, email, passwordHash, imagenUrl, telefono === undefined ? null : telefono, cedula || null, userId]
    );

    return res.status(200).json({
      message: "Usuario actualizado correctamente",
      user: result.rows[0],
    });
  } catch (error) {
    console.error("Error editando usuario desde administración:", error);
    if (error.code === "23505") {
      return res.status(409).json({ error: "El email ya está registrado" });
    }
    return res.status(500).json({ error: "Error interno del servidor", details: String(error.message) });
  }
};

const cambiarCorreoClienteAdmin = async (req, res) => {
  const userId = parsePositiveInt(req.params.id);
  const email = typeof req.body.email === "string" ? req.body.email.trim().toLowerCase() : "";
  const motivo = typeof req.body.motivo === "string" ? req.body.motivo.trim() : "";
  const identidadConfirmada = req.body.identidad_confirmada === true;

  if (!userId) return res.status(400).json({ error: "ID de usuario inválido" });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 100) {
    return res.status(400).json({ error: "Ingresa un correo electrónico válido" });
  }
  if (motivo.length < 8 || motivo.length > 500) {
    return res.status(400).json({ error: "Describe el motivo de la recuperación (mínimo 8 caracteres)" });
  }
  if (!identidadConfirmada) {
    return res.status(400).json({ error: "Debes confirmar que verificaste la identidad del titular" });
  }

  let client;
  let customer;
  let token;
  let auditId;
  try {
    client = await pool.connect();
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext(LOWER($1)))", [email]);
    const currentResult = await client.query(
      "SELECT id, nombre, email, pending_email, rol FROM usuarios WHERE id = $1 FOR UPDATE",
      [userId]
    );
    if (currentResult.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Cliente no encontrado" });
    }

    customer = currentResult.rows[0];
    if (customer.rol !== "cliente") {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "La recuperación de correo solo está disponible para cuentas de cliente" });
    }
    if (String(customer.email).toLowerCase() === email) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "El nuevo correo debe ser diferente al correo actual" });
    }

    const conflict = await client.query(
      `SELECT id FROM usuarios
       WHERE id <> $1 AND (
         LOWER(email) = LOWER($2) OR LOWER(pending_email) = LOWER($2)
       )
       LIMIT 1`,
      [userId, email]
    );
    if (conflict.rowCount > 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Ese correo ya está asociado o pendiente en otra cuenta" });
    }

    const verification = createEmailVerificationToken();
    token = verification.token;
    await client.query(
      `UPDATE usuarios
       SET pending_email = $1,
           email_verified_at = NULL,
           email_verification_token_hash = $2,
           email_verification_expires_at = $3,
           session_version = COALESCE(session_version, 0) + 1
       WHERE id = $4`,
      [email, verification.tokenHash, verification.expiresAt, userId]
    );
    const auditResult = await client.query(
      `INSERT INTO admin_email_change_audit
       (user_id, admin_id, accion, email_anterior, email_nuevo, motivo, identidad_confirmada)
       VALUES ($1, $2, 'cambio', $3, $4, $5, true)
       RETURNING id`,
      [userId, req.user.id, customer.email, email, motivo]
    );
    auditId = auditResult.rows[0]?.id;
    await client.query("COMMIT");
  } catch (error) {
    try { await client?.query("ROLLBACK"); } catch (rollbackError) {
      console.error("Error revirtiendo recuperación de correo:", rollbackError);
    }
    if (error?.code === "23505") {
      return res.status(409).json({ error: "Ese correo ya está asociado a otra cuenta" });
    }
    console.error("Error preparando recuperación de correo:", error);
    return res.status(500).json({ error: "No se pudo preparar el cambio de correo" });
  } finally {
    client?.release();
  }

  const verificationEmail = await sendEmailVerification(email, customer.nombre, token);
  const oldEmailNotice = await enviarCorreo({
    to: customer.email,
    subject: "Aviso de seguridad sobre tu cuenta Turesma",
    text: "Se solicitó un cambio de correo para tu cuenta de Turesma. Si no reconoces esta solicitud, comunícate con Turesma para proteger tu cuenta.",
    html: "<div style=\"font-family:Arial,sans-serif;line-height:1.6;color:#111827\"><h2>Aviso de seguridad</h2><p>Se solicitó un cambio de correo para tu cuenta de Turesma. Si no reconoces esta solicitud, comunícate con Turesma para proteger tu cuenta.</p></div>",
  });
  let deliveryAuditSaved = true;
  try {
    await pool.query(
      `UPDATE admin_email_change_audit
       SET verificacion_enviada = $1, aviso_correo_anterior_enviado = $2
       WHERE id = $3`,
      [verificationEmail.sent, oldEmailNotice.sent, auditId]
    );
  } catch (error) {
    deliveryAuditSaved = false;
    console.error("No se pudo guardar el resultado de envío del cambio de correo:", error);
  }

  return res.status(200).json({
    message: verificationEmail.sent
      ? "Cambio pendiente. Se envió el enlace de verificación al nuevo correo."
      : "El cambio quedó pendiente, pero no se pudo enviar el enlace. Comprueba el SMTP y reenvía la verificación.",
    verification_sent: verificationEmail.sent,
    old_email_notified: oldEmailNotice.sent,
    delivery_audit_saved: deliveryAuditSaved,
  });
};

const reenviarVerificacionCorreoClienteAdmin = async (req, res) => {
  const userId = parsePositiveInt(req.params.id);
  if (!userId) return res.status(400).json({ error: "ID de usuario inválido" });

  let client;
  let customer;
  let token;
  let auditId;
  try {
    client = await pool.connect();
    await client.query("BEGIN");
    const result = await client.query(
      "SELECT id, nombre, email, pending_email, rol FROM usuarios WHERE id = $1 FOR UPDATE",
      [userId]
    );
    if (result.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Cliente no encontrado" });
    }
    customer = result.rows[0];
    if (customer.rol !== "cliente" || !customer.pending_email) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "El cliente no tiene un cambio de correo pendiente" });
    }

    const verification = createEmailVerificationToken();
    token = verification.token;
    await client.query(
      `UPDATE usuarios
       SET email_verification_token_hash = $1, email_verification_expires_at = $2
       WHERE id = $3`,
      [verification.tokenHash, verification.expiresAt, userId]
    );
    const auditResult = await client.query(
      `INSERT INTO admin_email_change_audit
       (user_id, admin_id, accion, email_anterior, email_nuevo, motivo, identidad_confirmada)
       VALUES ($1, $2, 'reenviar', $3, $4, 'Reenvío de enlace del cambio previamente autorizado', false)
       RETURNING id`,
      [userId, req.user.id, customer.email, customer.pending_email]
    );
    auditId = auditResult.rows[0]?.id;
    await client.query("COMMIT");
  } catch (error) {
    try { await client?.query("ROLLBACK"); } catch (rollbackError) {
      console.error("Error revirtiendo reenvío de verificación:", rollbackError);
    }
    console.error("Error preparando reenvío de verificación:", error);
    return res.status(500).json({ error: "No se pudo preparar el reenvío" });
  } finally {
    client?.release();
  }

  const verificationEmail = await sendEmailVerification(customer.pending_email, customer.nombre, token);
  let deliveryAuditSaved = true;
  try {
    await pool.query(
      `UPDATE admin_email_change_audit
       SET verificacion_enviada = $1
       WHERE id = $2`,
      [verificationEmail.sent, auditId]
    );
  } catch (error) {
    deliveryAuditSaved = false;
    console.error("No se pudo guardar el resultado del reenvío de correo:", error);
  }
  return res.status(200).json({
    message: verificationEmail.sent
      ? "Enlace de verificación reenviado al nuevo correo."
      : "No se pudo enviar el enlace. Comprueba la configuración de correo e inténtalo de nuevo.",
    verification_sent: verificationEmail.sent,
    delivery_audit_saved: deliveryAuditSaved,
  });
};

const eliminarUsuarioAdmin = async (req, res) => {
  const userId = parsePositiveInt(req.params.id);

  if (!userId) {
    return res.status(400).json({ error: "ID de usuario inválido" });
  }

  try {
    const result = await pool.query(
      `DELETE FROM usuarios
       WHERE id = $1
       RETURNING id, nombre, email, rol, edad, capacidad_pasajeros, activo, creado_en`,
      [userId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Usuario no encontrado" });
    }

    return res.status(200).json({
      message: "Usuario eliminado correctamente",
      user: result.rows[0],
    });
  } catch (error) {
    if (error.code === "23503") {
      try {
        const fallbackResult = await pool.query(
          `UPDATE usuarios
           SET activo = false
           WHERE id = $1
           RETURNING id, nombre, email, rol, edad, capacidad_pasajeros, activo, creado_en`,
          [userId]
        );

        if (fallbackResult.rowCount === 0) {
          return res.status(404).json({ error: "Usuario no encontrado" });
        }

        return res.status(200).json({
          message: "El usuario tiene reservas relacionadas; se cambió a inactivo",
          user: fallbackResult.rows[0],
        });
      } catch (fallbackError) {
        console.error("Error inactivando usuario tras restricción FK:", fallbackError);
        return res.status(500).json({ error: "Error interno del servidor" });
      }
    }

    console.error("Error eliminando usuario:", error);
    return res.status(500).json({ error: "Error interno del servidor" });
  }
};

const recuperarPasswordUsuarioAdmin = async (req, res) => {
  const userId = parsePositiveInt(req.params.id);
  const { nueva_password } = req.body;

  if (!userId) {
    return res.status(400).json({ error: "ID de usuario inválido" });
  }

  if (!nueva_password || String(nueva_password).trim().length < 6) {
    return res.status(400).json({
      error: "Debes enviar una nueva contraseña con al menos 6 caracteres",
    });
  }

  try {
    const hashedPassword = await bcrypt.hash(String(nueva_password), 10);

    const result = await pool.query(
      `UPDATE usuarios
       SET password_hash = $1
       WHERE id = $2
       RETURNING id, nombre, email, rol, edad, capacidad_pasajeros, activo, creado_en`,
      [hashedPassword, userId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Usuario no encontrado" });
    }

    return res.status(200).json({
      message: "Contraseña restablecida correctamente",
      user: result.rows[0],
    });
  } catch (error) {
    console.error("Error recuperando contraseña de usuario:", error);
    return res.status(500).json({ error: "Error interno del servidor" });
  }
};

module.exports = {
  crearUsuarioAdmin,
  listarUsuariosAdmin,
  editarUsuarioAdmin,
  cambiarCorreoClienteAdmin,
  reenviarVerificacionCorreoClienteAdmin,
  eliminarUsuarioAdmin,
  recuperarPasswordUsuarioAdmin,
};
