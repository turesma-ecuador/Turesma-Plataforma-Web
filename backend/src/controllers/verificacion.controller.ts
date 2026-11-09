export {};

const pool = require("../config/db");
const multer = require("multer");
const { uploadImage } = require("../config/storage");
const { normalizeIdentification } = require("../config/identificacion");

const verificationUpload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (_req: any, file: any, cb: any) => {
    if (!["image/jpeg", "image/png", "image/webp"].includes(String(file.mimetype || "").toLowerCase())) {
      return cb(new Error("Formato inválido. Solo se permite JPG, PNG o WEBP"));
    }
    cb(null, true);
  },
  limits: { fileSize: 8 * 1024 * 1024 },
}).single("imagen");

const subirDocumentoVerificacion = (req: any, res: any) => {
  verificationUpload(req, res, async (error: any) => {
    if (error) return res.status(400).json({ error: error.message || "No se pudo subir la imagen" });
    if (!req.file) return res.status(400).json({ error: "Debes seleccionar una imagen" });
    const tipo = String(req.body?.tipo || "");
    if (!["cedula", "selfie"].includes(tipo)) return res.status(400).json({ error: "Tipo de documento inválido" });
    try {
      const imageUrl = await uploadImage(req.file, tipo === "cedula" ? "cedulas" : "selfies");
      await pool.query(
        `UPDATE usuarios SET ${tipo === "cedula" ? "cedula_url" : "selfie_cedula_url"} = $1,
         estado_verificacion = 'no_verificado', fecha_verificacion = NULL, verificado_por = NULL
         WHERE id = $2`,
        [imageUrl, req.user.id]
      );
      return res.status(201).json({ message: "Documento subido correctamente", imageUrl });
    } catch (uploadError) {
      console.error("Error guardando documento de verificación:", uploadError);
      return res.status(502).json({ error: "No se pudo guardar el documento" });
    }
  });
};

// ── Cliente: envía sus documentos para revisión administrativa ───────────────
const enviarVerificacion = async (req: any, res: any) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: "No autenticado" });

  const identification = normalizeIdentification(
    req.body.tipo_identificacion || "cedula",
    req.body.cedula
  );
  const cedula = identification.value;
  const cedulaUrl = typeof req.body.cedula_url === "string" ? req.body.cedula_url.trim() : "";
  const selfieUrl = typeof req.body.selfie_cedula_url === "string" ? req.body.selfie_cedula_url.trim() : "";

  if (!cedula) return res.status(400).json({ error: identification.error });
  if (!cedulaUrl || !selfieUrl) return res.status(400).json({ error: "Debes subir tu documento de identificación y una selfie sosteniéndolo" });
  try {
    await pool.query(
      `UPDATE usuarios
       SET cedula = $1, tipo_identificacion = $2, cedula_url = $3, selfie_cedula_url = $4, estado_verificacion = 'pendiente',
           notas_verificacion = NULL, fecha_verificacion = NULL, verificado_por = NULL
       WHERE id = $5`,
      [cedula, identification.type, cedulaUrl, selfieUrl, userId]
    );

    return res.status(200).json({ message: "Tus documentos fueron enviados para revisión." });
  } catch (error: any) {
    if (error?.code === "23505") {
      return res.status(409).json({ error: "El número de identificación ya se encuentra registrado. Si crees que es un error, comunícate con un administrador." });
    }
    console.error("Error enviando verificación:", error);
    return res.status(500).json({ error: "Error interno del servidor" });
  }
};

// ── Cliente: consulta el estado de su propia verificación ────────────────────
const miVerificacion = async (req: any, res: any) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: "No autenticado" });

  try {
    const r = await pool.query(
      `      SELECT cedula, tipo_identificacion, cedula_url, selfie_cedula_url, email_verified_at, pending_email,
              COALESCE(estado_verificacion, 'no_verificado') AS estado_verificacion,
              notas_verificacion, fecha_verificacion
       FROM usuarios WHERE id = $1 LIMIT 1`,
      [userId]
    );
    if (r.rowCount === 0) return res.status(404).json({ error: "Usuario no encontrado" });
    return res.status(200).json(r.rows[0]);
  } catch (error) {
    console.error("Error consultando verificación:", error);
    return res.status(500).json({ error: "Error interno del servidor" });
  }
};

module.exports = { enviarVerificacion, miVerificacion, subirDocumentoVerificacion };
