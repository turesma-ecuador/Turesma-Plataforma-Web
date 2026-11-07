export {};

const multer = require("multer");
const { uploadImage } = require("../../config/storage");

const storage = multer.memoryStorage();

const fileFilter = (_req, file, cb) => {
  const allowedMimeTypes = ["image/jpeg", "image/png", "image/webp"];

  if (!allowedMimeTypes.includes(String(file.mimetype || "").toLowerCase())) {
    return cb(new Error("Formato inválido. Solo se permite JPG, PNG o WEBP"));
  }

  cb(null, true);
};

const uploadVehiculoImageMiddleware = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024,
  },
}).single("imagen");

const uploadViajeImagesMiddleware = multer({
  storage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024, files: 8 },
}).array("imagenes", 8);

const uploadVehiculoImagen = (req, res) => {
  uploadVehiculoImageMiddleware(req, res, async (error) => {
    if (error) {
      return res.status(400).json({ error: error.message || "No se pudo subir la imagen" });
    }

    if (!req.file) {
      return res.status(400).json({ error: "Debes seleccionar una imagen" });
    }

    let imageUrl;
    try {
      imageUrl = await uploadImage(req.file, "vehiculos");
    } catch (uploadError) {
      console.error("Error guardando imagen de vehículo:", uploadError);
      return res.status(502).json({ error: "No se pudo guardar la imagen" });
    }

    return res.status(201).json({
      message: "Imagen subida correctamente",
      imageUrl,
      filename: req.file.filename,
    });
  });
};

const uploadViajeImagenes = (req, res) => {
  uploadViajeImagesMiddleware(req, res, async (error) => {
    if (error) return res.status(400).json({ error: error.message || "No se pudieron subir las imágenes" });
    const files = Array.isArray(req.files) ? req.files : [];
    if (!files.length) return res.status(400).json({ error: "Debes seleccionar al menos una imagen" });
    try {
      const imageUrls = [];
      for (const file of files) imageUrls.push(await uploadImage(file, "viajes"));
      return res.status(201).json({ message: "Imágenes subidas correctamente", imageUrls });
    } catch (uploadError: any) {
      console.error("Error subiendo imágenes del viaje:", uploadError);
      const detail = process.env.NODE_ENV === "production" ? "" : `: ${uploadError?.message || "error de Storage"}`;
      return res.status(502).json({ error: `No se pudieron guardar las imágenes${detail}` });
    }
  });
};

module.exports = {
  uploadVehiculoImagen,
  uploadViajeImagenes,
};
