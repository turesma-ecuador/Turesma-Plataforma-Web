export {};

const pool = require("../config/db");

const parsePositiveInt = (value) => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
};

const getAuthenticatedUserId = (req) => {
  const userId = parsePositiveInt(req.user?.id);
  return userId;
};

const getMessageContext = async (userId, linkType, linkId) => {
  const parsedLinkId = parsePositiveInt(linkId);
  if (!parsedLinkId || !["cotizacion", "requerimiento", "reserva"].includes(linkType)) {
    return { error: "El contexto de la conversación no es válido", status: 400 };
  }

  let contextResult;
  let canonicalType = linkType;
  let canonicalId = parsedLinkId;
  if (linkType === "reserva") {
    contextResult = await pool.query(
      `SELECT r.usuario_id, rp.id AS requerimiento_id, c.id AS cotizacion_id
       FROM reservas r
       LEFT JOIN requerimientos_personalizados rp
         ON rp.reserva_id = r.id AND rp.usuario_id = r.usuario_id
       LEFT JOIN cotizaciones c
         ON c.reserva_id = r.id AND c.usuario_id = r.usuario_id
       WHERE r.id = $1
       ORDER BY rp.id ASC, c.id ASC
       LIMIT 1`,
      [parsedLinkId]
    );
    if (contextResult.rows[0]?.requerimiento_id) {
      canonicalType = "requerimiento";
      canonicalId = Number(contextResult.rows[0].requerimiento_id);
    } else if (contextResult.rows[0]?.cotizacion_id) {
      canonicalType = "cotizacion";
      canonicalId = Number(contextResult.rows[0].cotizacion_id);
    }
  } else if (linkType === "requerimiento") {
    contextResult = await pool.query(
      "SELECT usuario_id FROM requerimientos_personalizados WHERE id = $1",
      [parsedLinkId]
    );
  } else {
    contextResult = await pool.query(
      "SELECT usuario_id FROM cotizaciones WHERE id = $1",
      [parsedLinkId]
    );
  }

  if (!contextResult?.rowCount) {
    return { error: "No se encontró el servicio asociado a la conversación", status: 404 };
  }

  const ownerId = Number(contextResult.rows[0].usuario_id);
  const senderResult = await pool.query(
    "SELECT rol, activo FROM usuarios WHERE id = $1",
    [userId]
  );
  if (!senderResult.rowCount || senderResult.rows[0].activo === false) {
    return { error: "Sesión inválida", status: 401 };
  }
  const role = String(senderResult.rows[0].rol || "").toLowerCase();
  const isAdmin = role === "admin" || role === "operativo";
  if (!isAdmin && ownerId !== userId) {
    return { error: "No tienes acceso a esta conversación", status: 403 };
  }

  return {
    ownerId,
    isAdmin,
    linkType: canonicalType,
    linkId: canonicalId,
    reservaId: linkType === "reserva" ? parsedLinkId : null,
  };
};

const listContactos = async (req, res) => {
  const userId = getAuthenticatedUserId(req);

  if (!userId) {
    return res.status(401).json({ error: "Sesión inválida" });
  }

  try {
    const userResult = await pool.query(
      "SELECT id, rol FROM usuarios WHERE id = $1 LIMIT 1",
      [userId]
    );

    if (userResult.rowCount === 0) {
      return res.status(404).json({ error: "Usuario no encontrado" });
    }

    const rol = String(userResult.rows[0].rol || "").toLowerCase();

    if (rol === "admin") {
      const all = await pool.query(
        `SELECT id, nombre, email, rol, telefono
         FROM usuarios
         WHERE id <> $1
           AND activo = true
         ORDER BY rol ASC, nombre ASC`,
        [userId]
      );

      return res.status(200).json(all.rows);
    }

    if (rol === "vehiculo") {
      // Vehículo puede hablar con:
      // 1. Otros vehículos
      // 2. Clientes que han hecho reservas con él
      // 3. Admin
      const contactos = await pool.query(
        `SELECT DISTINCT u.id, u.nombre, u.email, u.rol, u.telefono
         FROM usuarios u
         WHERE u.id <> $1
           AND u.activo = true
           AND (
             u.rol = 'admin'
             OR u.rol = 'vehiculo'
             OR u.id IN (
               SELECT DISTINCT r.usuario_id
               FROM reservas r
               WHERE r.vehiculo_id IN (
                 SELECT v.id FROM vehiculos v WHERE v.usuario_id = $1
               )
             )
           )
         ORDER BY u.rol DESC, u.nombre ASC`,
        [userId]
      );

      return res.status(200).json(contactos.rows);
    }

    // Cliente puede hablar con:
    // 1. Vehículos que han aceptado sus reservas
    // 2. Admin
    const clienteContactos = await pool.query(
      `SELECT DISTINCT u.id, u.nombre, u.email, u.rol, u.telefono
       FROM usuarios u
       WHERE u.id <> $1
         AND u.activo = true
         AND (
           u.rol = 'admin'
           OR u.id IN (
             SELECT DISTINCT v.usuario_id
             FROM reservas r
             INNER JOIN vehiculos v ON v.id = r.vehiculo_id
             WHERE r.usuario_id = $1
               AND r.estado IN ('confirmada', 'en_curso', 'finalizada', 'cancelada')
           )
         )
       ORDER BY u.rol DESC, u.nombre ASC`,
      [userId]
    );

    return res.status(200).json(clienteContactos.rows);
  } catch (error) {
    console.error("Error listando contactos de comunicación:", error);
    return res.status(500).json({ error: "Error interno del servidor" });
  }
};

const listMensajes = async (req, res) => {
  const userId = getAuthenticatedUserId(req);
  const contactId = parsePositiveInt(req.query.contactId);

  if (!userId) {
    return res.status(401).json({ error: "Sesión inválida" });
  }

  const hasLinkType = req.query.link_type !== undefined;
  const hasLinkId = req.query.link_id !== undefined;
  if (hasLinkType || hasLinkId) {
    if (!hasLinkType || !hasLinkId) {
      return res.status(400).json({ error: "Debes enviar link_type y link_id" });
    }
    try {
      const context = await getMessageContext(userId, String(req.query.link_type), req.query.link_id);
      if (context.error) return res.status(context.status).json({ error: context.error });

      await pool.query(
        `UPDATE mensajes_comunicacion
         SET leido = true, leido_en = CURRENT_TIMESTAMP
         WHERE link_type = $1 AND link_id = $2
           AND recipient_user_id = $3
           AND COALESCE(leido, false) = false`,
        [context.linkType, context.linkId, userId]
      );
      const result = await pool.query(
        `SELECT m.id, m.sender_user_id, m.recipient_user_id, m.mensaje, m.creado_en,
                COALESCE(m.leido, false) AS leido, u.nombre AS sender_nombre, u.rol AS sender_rol,
                (m.sender_user_id = $3) AS es_mio
         FROM mensajes_comunicacion m
         INNER JOIN usuarios u ON u.id = m.sender_user_id
         WHERE m.link_type = $1 AND m.link_id = $2
         ORDER BY m.creado_en ASC, m.id ASC
         LIMIT 200`,
        [context.linkType, context.linkId, userId]
      );
      return res.status(200).json(result.rows);
    } catch (error) {
      console.error("Error listando conversación:", error);
      return res.status(500).json({ error: "No se pudo cargar la conversación" });
    }
  }

  if (!contactId) {
    return res.status(userId ? 400 : 401).json({
      error: "Debes enviar un contacto o el contexto de la conversación",
    });
  }

  try {
    await pool.query(
      `UPDATE mensajes_comunicacion
       SET leido = true,
           leido_en = CURRENT_TIMESTAMP
       WHERE recipient_user_id = $1
         AND sender_user_id = $2
         AND link_type IS NULL AND link_id IS NULL
         AND COALESCE(leido, false) = false`,
      [userId, contactId]
    );

    const result = await pool.query(
      `SELECT id, sender_user_id, recipient_user_id, mensaje, reserva_id, creado_en, COALESCE(leido, false) AS leido, leido_en
       FROM mensajes_comunicacion
       WHERE ((sender_user_id = $1 AND recipient_user_id = $2)
          OR (sender_user_id = $2 AND recipient_user_id = $1))
         AND link_type IS NULL AND link_id IS NULL
       ORDER BY creado_en ASC, id ASC
       LIMIT 200`,
      [userId, contactId]
    );

    return res.status(200).json(result.rows);
  } catch (error) {
    console.error("Error listando mensajes:", error);
    return res.status(500).json({ error: "Error interno del servidor" });
  }
};

const sendMensaje = async (req, res) => {
  const senderUserId = getAuthenticatedUserId(req);
  const recipientUserId = parsePositiveInt(req.body.recipient_user_id);
  const mensaje = String(req.body.mensaje || "").trim();
  const reservaId = req.body.reserva_id ? parsePositiveInt(req.body.reserva_id) : null;

  if (!senderUserId) {
    return res.status(401).json({ error: "Sesión inválida" });
  }
  if (!mensaje || mensaje.length > 2000) {
    return res.status(400).json({ error: "El mensaje debe tener entre 1 y 2000 caracteres" });
  }

  const hasLinkType = req.body.link_type !== undefined;
  const hasLinkId = req.body.link_id !== undefined;
  if (hasLinkType || hasLinkId) {
    if (!hasLinkType || !hasLinkId) {
      return res.status(400).json({ error: "Debes enviar link_type y link_id" });
    }
    try {
      const context = await getMessageContext(senderUserId, String(req.body.link_type), req.body.link_id);
      if (context.error) return res.status(context.status).json({ error: context.error });

      let recipientId = context.ownerId;
      if (!context.isAdmin) {
        const assignedAdmin = await pool.query(
          `SELECT CASE WHEN m.sender_user_id = $3 THEN m.recipient_user_id ELSE m.sender_user_id END AS id
           FROM mensajes_comunicacion m
           INNER JOIN usuarios u
             ON u.id = CASE WHEN m.sender_user_id = $3 THEN m.recipient_user_id ELSE m.sender_user_id END
           WHERE m.link_type = $1 AND m.link_id = $2
             AND (m.sender_user_id = $3 OR m.recipient_user_id = $3)
             AND LOWER(u.rol) = 'admin' AND u.activo = true
           ORDER BY m.id ASC
           LIMIT 1`,
          [context.linkType, context.linkId, senderUserId]
        );
        const adminResult = assignedAdmin.rowCount ? assignedAdmin : await pool.query(
          `SELECT id FROM usuarios
           WHERE LOWER(rol) = 'admin' AND activo = true
           ORDER BY id ASC LIMIT 1`
        );
        if (!adminResult.rowCount) {
          return res.status(503).json({ error: "No hay un administrador disponible para recibir el mensaje" });
        }
        recipientId = Number(adminResult.rows[0].id);
      }

      const recipient = await pool.query(
        "SELECT id FROM usuarios WHERE id = $1 AND COALESCE(activo, true) = true",
        [recipientId]
      );
      if (!recipient.rowCount) {
        return res.status(404).json({ error: "El destinatario de la conversación no está disponible" });
      }

      const result = await pool.query(
        `INSERT INTO mensajes_comunicacion
           (sender_user_id, recipient_user_id, mensaje, reserva_id, leido, link_type, link_id)
         VALUES ($1, $2, $3, $4, false, $5, $6)
         RETURNING id, sender_user_id, recipient_user_id, mensaje, reserva_id, link_type, link_id, creado_en,
                   COALESCE(leido, false) AS leido`,
        [senderUserId, recipientId, mensaje, context.reservaId, context.linkType, context.linkId]
      );
      return res.status(201).json({ message: "Mensaje enviado", mensaje: result.rows[0] });
    } catch (error) {
      console.error("Error enviando mensaje contextual:", error);
      return res.status(500).json({ error: "No se pudo enviar el mensaje" });
    }
  }

  if (!recipientUserId) {
    return res.status(senderUserId ? 400 : 401).json({
      error: "Debes enviar un destinatario o el contexto de la conversación",
    });
  }

  if (senderUserId === recipientUserId) {
    return res.status(400).json({ error: "No puedes enviarte mensajes a ti mismo" });
  }

  try {
    const users = await pool.query(
      `SELECT id
       FROM usuarios
       WHERE id IN ($1, $2)
         AND activo = true`,
      [senderUserId, recipientUserId]
    );

    if (users.rowCount < 2) {
      return res.status(404).json({ error: "Uno de los usuarios no existe o está inactivo" });
    }

    const result = await pool.query(
      `INSERT INTO mensajes_comunicacion (
         sender_user_id,
         recipient_user_id,
         mensaje,
         reserva_id,
         link_type,
         link_id,
         leido
       )
       VALUES ($1, $2, $3, $4, NULL, NULL, false)
       RETURNING id, sender_user_id, recipient_user_id, mensaje, reserva_id, creado_en, COALESCE(leido, false) AS leido`,
      [senderUserId, recipientUserId, mensaje, reservaId]
    );

    return res.status(201).json({
      message: "Mensaje enviado",
      mensaje: result.rows[0],
    });
  } catch (error) {
    console.error("Error enviando mensaje:", error);
    return res.status(500).json({ error: "Error interno del servidor" });
  }
};

const listNotificaciones = async (req, res) => {
  const userId = getAuthenticatedUserId(req);

  if (!userId) {
    return res.status(401).json({ error: "Sesión inválida" });
  }

  try {
    const unreadResult = await pool.query(
      `SELECT COUNT(*)::int AS unread_count
       FROM mensajes_comunicacion
       WHERE recipient_user_id = $1
         AND COALESCE(leido, false) = false`,
      [userId]
    );

    const notificationsResult = await pool.query(
      `SELECT
         m.id,
         m.sender_user_id,
         m.recipient_user_id,
         m.mensaje,
         m.reserva_id,
         m.link_type,
         m.link_id,
         m.creado_en,
         COALESCE(m.leido, false) AS leido,
         u.nombre AS sender_nombre,
         u.rol AS sender_rol
       FROM mensajes_comunicacion m
       INNER JOIN usuarios u ON u.id = m.sender_user_id
       WHERE m.recipient_user_id = $1
       ORDER BY m.creado_en DESC, m.id DESC
       LIMIT 20`,
      [userId]
    );

    return res.status(200).json({
      unread_count: unreadResult.rows[0]?.unread_count || 0,
      notifications: notificationsResult.rows,
    });
  } catch (error) {
    console.error("Error listando notificaciones:", error);
    return res.status(500).json({ error: "Error interno del servidor" });
  }
};

const markNotificacionLeida = async (req, res) => {
  const notifId = parsePositiveInt(req.params.id);
  const userId = getAuthenticatedUserId(req);

  if (!notifId || !userId) {
    return res.status(userId ? 400 : 401).json({
      error: userId ? "Debes enviar un id de notificación válido" : "Sesión inválida",
    });
  }

  try {
    const result = await pool.query(
      `UPDATE mensajes_comunicacion
       SET leido = true,
           leido_en = CURRENT_TIMESTAMP
       WHERE id = $1
         AND recipient_user_id = $2
       RETURNING id`,
      [notifId, userId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Notificación no encontrada" });
    }

    return res.status(200).json({ message: "Notificación marcada como leída" });
  } catch (error) {
    console.error("Error marcando notificación:", error);
    return res.status(500).json({ error: "Error interno del servidor" });
  }
};

const markAllNotificacionesLeidas = async (req, res) => {
  const userId = getAuthenticatedUserId(req);

  if (!userId) {
    return res.status(401).json({ error: "Sesión inválida" });
  }

  try {
    const result = await pool.query(
      `UPDATE mensajes_comunicacion
       SET leido = true,
           leido_en = CURRENT_TIMESTAMP
       WHERE recipient_user_id = $1
         AND COALESCE(leido, false) = false`,
      [userId]
    );

    return res.status(200).json({
      message: "Notificaciones marcadas como leídas",
      updated: result.rowCount || 0,
    });
  } catch (error) {
    console.error("Error marcando notificaciones:", error);
    return res.status(500).json({ error: "Error interno del servidor" });
  }
};

module.exports = {
  listContactos,
  listMensajes,
  sendMensaje,
  listNotificaciones,
  markNotificacionLeida,
  markAllNotificacionesLeidas,
};
