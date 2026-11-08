export {};

const pool = require("./db");

export type LinkType = "cotizacion" | "reserva" | "requerimiento" | "pago" | null;

// Inserta una notificación (mensaje) para que aparezca en la campanita del destinatario.
// linkType/linkId permiten que el frontend navegue directo al recurso al hacer clic.
const crearNotificacion = async (
  senderId: number | null | undefined,
  recipientId: number | null | undefined,
  mensaje: string,
  reservaId: number | null = null,
  linkType: LinkType = null,
  linkId: number | null = null
) => {
  if (!senderId || !recipientId || Number(senderId) === Number(recipientId)) return;
  try {
    await pool.query(
      `INSERT INTO mensajes_comunicacion (sender_user_id, recipient_user_id, mensaje, reserva_id, leido, link_type, link_id)
       VALUES ($1, $2, $3, $4, false, $5, $6)`,
      [senderId, recipientId, mensaje, reservaId, linkType, linkId]
    );
  } catch (e: any) {
    console.error("Error creando notificación:", e.message);
  }
};

// Notifica a todos los administradores activos.
const notificarAdmins = async (
  senderId: number | null | undefined,
  mensaje: string,
  linkType: LinkType = null,
  linkId: number | null = null
) => {
  try {
    const admins = await pool.query(`SELECT id FROM usuarios WHERE rol = 'admin' AND activo = true`);
    for (const a of admins.rows) {
      await crearNotificacion(senderId, a.id, mensaje, null, linkType, linkId);
    }
  } catch (e: any) {
    console.error("Error notificando admins:", e.message);
  }
};

// Dado un conductores.id, devuelve el usuario_id (para notificar al conductor).
const usuarioIdDeConductor = async (conductorId: number | null | undefined): Promise<number | null> => {
  if (!conductorId) return null;
  try {
    const r = await pool.query(`SELECT usuario_id FROM conductores WHERE id = $1 LIMIT 1`, [conductorId]);
    return r.rowCount ? Number(r.rows[0].usuario_id) : null;
  } catch {
    return null;
  }
};

module.exports = { crearNotificacion, notificarAdmins, usuarioIdDeConductor };
