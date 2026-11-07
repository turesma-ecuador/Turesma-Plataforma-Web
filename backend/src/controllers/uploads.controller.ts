export {};

const fs = require("fs");
const path = require("path");
const multer = require("multer");
const pool = require("../config/db");
const jwt = require("jsonwebtoken");
const { JWT_SECRET } = require("../middleware/auth.middleware");
const { getUploadsRoot, uploadImage } = require("../config/storage");

const fileFilter = (_req, file, cb) => {
  const allowedMimeTypes = ["image/jpeg", "image/png", "image/webp"];

  if (!allowedMimeTypes.includes(String(file.mimetype || "").toLowerCase())) {
    return cb(new Error("Formato inválido. Solo se permite JPG, PNG o WEBP"));
  }

  cb(null, true);
};

const uploadPerfilImageMiddleware = multer({
  storage: multer.memoryStorage(),
  fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024,
  },
}).single("imagen");

const uploadPerfilImagen = (req, res) => {
  uploadPerfilImageMiddleware(req, res, async (error) => {
    if (error) {
      return res.status(400).json({ error: error.message || "No se pudo subir la imagen" });
    }

    if (!req.file) {
      return res.status(400).json({ error: "Debes seleccionar una imagen" });
    }

    let imageUrl;
    try {
      imageUrl = await uploadImage(req.file, "perfiles");
    } catch (uploadError) {
      console.error("Error guardando foto de perfil:", uploadError);
      return res.status(502).json({ error: "No se pudo guardar la foto de perfil" });
    }

    return res.status(201).json({
      message: "Imagen subida correctamente",
      imageUrl,
      filename: imageUrl.split("/").pop(),
    });
  });
};

// ── Comprobante de pago (transferencia / link de pago) ───────────────────────
const comprobantesDir = path.join(getUploadsRoot(), "comprobantes");
fs.mkdirSync(comprobantesDir, { recursive: true });

const comprobanteStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, comprobantesDir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase();
    const safeExt = [".jpg", ".jpeg", ".png", ".webp"].includes(ext) ? ext : ".jpg";
    const uniqueName = `comprobante-${Date.now()}-${Math.round(Math.random() * 1e9)}${safeExt}`;
    cb(null, uniqueName);
  },
});

const uploadComprobanteMiddleware = multer({
  storage: comprobanteStorage,
  fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024,
  },
}).single("comprobante");

const uploadComprobantePago = (req, res) => {
  uploadComprobanteMiddleware(req, res, (error) => {
    if (error) {
      return res.status(400).json({ error: error.message || "No se pudo subir el comprobante" });
    }

    if (!req.file) {
      return res.status(400).json({ error: "Debes adjuntar una imagen del comprobante" });
    }

    const accessToken = jwt.sign(
      { file: req.file.filename, uid: Number(req.user?.id) },
      JWT_SECRET,
      { expiresIn: "15m" }
    );
    const imageUrl = `${req.protocol}://${req.get("host")}/api/usuarios/comprobantes/${encodeURIComponent(req.file.filename)}?token=${encodeURIComponent(accessToken)}`;

    return res.status(201).json({
      message: "Comprobante subido correctamente",
      imageUrl,
      filename: req.file.filename,
    });
  });
};

const serveComprobante = async (req, res) => {
  const filename = path.basename(String(req.params.filename || ""));
  if (!filename || filename !== req.params.filename) {
    return res.status(400).json({ error: "Archivo inválido" });
  }

  try {
    const accessToken = typeof req.query.token === "string" ? req.query.token : "";
    if (accessToken) {
      let claims;
      try {
        claims = jwt.verify(accessToken, JWT_SECRET);
      } catch {
        return res.status(403).json({ error: "El enlace del comprobante expiró o no es válido" });
      }
      if (claims.file !== filename) return res.status(403).json({ error: "Token de archivo inválido" });
      return res.sendFile(path.join(comprobantesDir, filename));
    }

    const role = String(req.user?.rol || "").toLowerCase();
    const userId = Number(req.user?.id);
    const access = await pool.query(
      `SELECT 1
       FROM pagos_reserva p
       WHERE p.comprobante_url LIKE $1
         AND ($2 = 'admin' OR $2 = 'operativo' OR p.usuario_id = $3)
       LIMIT 1`,
      [`%/${filename}`, role, userId]
    );
    if (!access.rowCount) return res.status(404).json({ error: "Comprobante no encontrado" });

    return res.sendFile(path.join(comprobantesDir, filename));
  } catch (error) {
    console.error("Error entregando comprobante:", error);
    return res.status(500).json({ error: "No se pudo entregar el comprobante" });
  }
};

module.exports = {
  uploadPerfilImagen,
  uploadComprobantePago,
  serveComprobante,
};
