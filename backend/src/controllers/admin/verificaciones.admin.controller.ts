export {};

const pool = require("../../config/db");
const { crearNotificacion } = require("../../config/notificaciones");
const { enviarCorreoVerificacionAprobada } = require("../../config/usuarioMailer");

// ── Admin: lista las verificaciones de identidad (filtrable por estado) ──────
const listarVerificaciones = async (req: any, res: any) => {
  try {
    const { estado } = req.query;
    const cond =
      estado && estado !== "todos"
        ? "AND COALESCE(u.estado_verificacion, 'no_verificado') = $1"
        : "AND COALESCE(u.estado_verificacion, 'no_verificado') <> 'no_verificado'";
    const params = estado && estado !== "todos" ? [estado] : [];

    const result = await pool.query(
      `SELECT u.id, u.nombre, u.email, u.telefono, u.cedula, u.tipo_identificacion, u.cedula_url, u.selfie_cedula_url,
              COALESCE(u.estado_verificacion, 'no_verificado') AS estado_verificacion,
              u.notas_verificacion, u.fecha_verificacion
       FROM usuarios u
       WHERE LOWER(u.rol) = 'cliente' ${cond}
       ORDER BY
         CASE WHEN COALESCE(u.estado_verificacion,'no_verificado') = 'pendiente' THEN 0 ELSE 1 END,
         u.fecha_verificacion DESC NULLS LAST, u.id DESC`,
      params
    );
    return res.status(200).json(result.rows);
  } catch (error) {
    console.error("Error listando verificaciones:", error);
    return res.status(500).json({ error: "Error interno del servidor" });
  }
};

// ── Admin: cuántas verificaciones están pendientes (para el badge) ───────────
const contarVerificacionesPendientes = async (_req: any, res: any) => {
  try {
    const r = await pool.query(
      "SELECT COUNT(*) AS total FROM usuarios WHERE LOWER(rol) = 'cliente' AND estado_verificacion = 'pendiente'"
    );
    return res.status(200).json({ pendientes: Number(r.rows[0]?.total || 0) });
  } catch (error) {
    console.error("Error contando verificaciones:", error);
    return res.status(500).json({ error: "Error interno del servidor" });
  }
};

// ── Admin: aprueba la identidad de un cliente ────────────────────────────────
const aprobarVerificacion = async (req: any, res: any) => {
  const clienteId = Number(req.params.id);
  if (!Number.isInteger(clienteId) || clienteId <= 0) return res.status(400).json({ error: "ID inválido" });

  try {
    const cliente = await pool.query(
      "SELECT id, nombre, email, estado_verificacion, cedula_url, selfie_cedula_url FROM usuarios WHERE id = $1 AND LOWER(rol) = 'cliente' LIMIT 1",
      [clienteId]
    );
    if (cliente.rowCount === 0) return res.status(404).json({ error: "Cliente no encontrado" });
    if (cliente.rows[0].estado_verificacion !== "pendiente")
      return res.status(400).json({ error: "Esta verificación no está pendiente" });
    if (!cliente.rows[0].cedula_url || !cliente.rows[0].selfie_cedula_url)
      return res.status(400).json({ error: "No se puede aprobar: faltan la cédula o la selfie" });

    await pool.query(
      `UPDATE usuarios
       SET estado_verificacion = 'verificado', fecha_verificacion = NOW(),
           verificado_por = $1, notas_verificacion = NULL
       WHERE id = $2`,
      [req.user?.id || null, clienteId]
    );

    await crearNotificacion(
      req.user?.id,
      clienteId,
      "Tu identidad fue VERIFICADA. Ya puedes solicitar y confirmar tus servicios en Turesma.",
      null,
      null,
      null
    );

    // Correo al cliente avisando que su identidad quedó verificada (best-effort).
    await enviarCorreoVerificacionAprobada({ email: cliente.rows[0].email, nombre: cliente.rows[0].nombre });

    return res.status(200).json({ message: "Cliente verificado" });
  } catch (error) {
    console.error("Error aprobando verificación:", error);
    return res.status(500).json({ error: "Error interno del servidor" });
  }
};

// ── Admin: rechaza la verificación (con motivo) ──────────────────────────────
const rechazarVerificacion = async (req: any, res: any) => {
  const clienteId = Number(req.params.id);
  const notas = typeof req.body.notas === "string" ? req.body.notas.trim().slice(0, 500) : null;
  if (!Number.isInteger(clienteId) || clienteId <= 0) return res.status(400).json({ error: "ID inválido" });

  try {
    const cliente = await pool.query(
      "SELECT id, estado_verificacion FROM usuarios WHERE id = $1 AND LOWER(rol) = 'cliente' LIMIT 1",
      [clienteId]
    );
    if (cliente.rowCount === 0) return res.status(404).json({ error: "Cliente no encontrado" });
    if (cliente.rows[0].estado_verificacion !== "pendiente")
      return res.status(400).json({ error: "Esta verificación no está pendiente" });

    await pool.query(
      `UPDATE usuarios
       SET estado_verificacion = 'rechazado', notas_verificacion = $1,
           fecha_verificacion = NOW(), verificado_por = $2
       WHERE id = $3`,
      [notas, req.user?.id || null, clienteId]
    );

    await crearNotificacion(
      req.user?.id,
      clienteId,
      `Tu verificación de identidad fue RECHAZADA${notas ? ": " + notas : ""}. Puedes volver a enviar tu documento.`,
      null,
      null,
      null
    );

    return res.status(200).json({ message: "Verificación rechazada" });
  } catch (error) {
    console.error("Error rechazando verificación:", error);
    return res.status(500).json({ error: "Error interno del servidor" });
  }
};

module.exports = {
  listarVerificaciones,
  contarVerificacionesPendientes,
  aprobarVerificacion,
  rechazarVerificacion,
};
