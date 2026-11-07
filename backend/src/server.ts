export {};

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const path = require("path");
require("dotenv").config();
const authRoutes = require("./routes/auth.routes");
const usuariosRoutes = require("./routes/usuarios.routes");
const adminRoutes = require("./routes/admin.routes");
const conductorRoutes = require("./routes/conductor.routes");
const comunicacionRoutes = require("./routes/comunicacion.routes");
const cotizacionesRoutes = require("./routes/cotizaciones.routes");
const requerimientosRoutes = require("./routes/requerimientos.routes");
const { initDatabase } = require("./config/initDb");
const pool = require("./config/db");
const { verifyToken } = require("./middleware/auth.middleware");
const { servePrivateFile } = require("./controllers/private-files.controller");
const { assertStorageConfig, getUploadsRoot } = require("./config/storage");

const app = express();
const uploadsRoot = getUploadsRoot();

// El hosting ejecuta esta API detrás de un proxy que añade X-Forwarded-For.
app.set("trust proxy", 1);

// Cabeceras de seguridad HTTP. Se permite cargar recursos (imágenes de
// vehículos/galería) desde otro origen, porque el frontend corre en otro puerto.
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
  contentSecurityPolicy: false, // esta API sirve JSON, no HTML propio
}));

// CORS: en producción se limita al dominio del frontend (CORS_ORIGIN); en
// desarrollo, si no está definido, se permite cualquier origen (localhost).
const corsOrigin = process.env.CORS_ORIGIN;
const allowedOrigins = corsOrigin
  ?.split(",")
  .map((origin: string) => origin.trim().replace(/\/+$/, ""))
  .filter(Boolean);
app.use(cors(allowedOrigins?.length ? { origin: allowedOrigins } : {}));

// Las publicaciones pueden incluir varias URLs de imágenes. El archivo nunca
// viaja dentro del JSON, pero el límite debe permitir galerías y metadatos.
app.use(express.json({ limit: "10mb" }));
for (const publicFolder of ["galeria", "perfiles", "vehiculos", "viajes", "videos"]) {
  app.use(`/uploads/${publicFolder}`, express.static(path.join(uploadsRoot, publicFolder), {
    fallthrough: false,
    immutable: true,
    maxAge: "1y",
  }));
}
app.get("/api/private-files/:folder/:filename", verifyToken, servePrivateFile);

// Límite de peticiones a autenticación: frena ataques de fuerza bruta al login
// y al envío de PIN de recuperación (por IP).
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 40,                  // 40 intentos por IP en esa ventana
  standardHeaders: true,
  legacyHeaders: false,
  // Las consultas autenticadas (por ejemplo /auth/me) son comprobaciones de
  // sesión, no intentos de acceso. No deben bloquear el inicio de sesión.
  skip: (req) => String(req.headers.authorization || "").startsWith("Bearer "),
  message: { error: "Demasiados intentos. Espera unos minutos e inténtalo de nuevo." },
});

app.use("/api/auth", authLimiter, authRoutes);
app.use("/api/usuarios", usuariosRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/conductor", conductorRoutes);
app.use("/api/comunicacion", comunicacionRoutes);
app.use("/api/cotizaciones", cotizacionesRoutes);
app.use("/api/requerimientos-personalizados", requerimientosRoutes);

// Mantiene las respuestas de la API en JSON incluso cuando una petición
// supera el límite, evitando que el frontend reciba una página HTML de error.
app.use((error: any, _req: any, res: any, next: any) => {
  if (error?.type === "entity.too.large") {
    return res.status(413).json({ error: "La solicitud es demasiado grande. Reduce el tamaño o la cantidad de imágenes." });
  }
  return next(error);
});

app.get("/", (req, res) => {
  res.send("API TURESMA funcionando 🚀");
});

// Health check endpoint
app.get("/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ status: "OK", message: "API Turesma está activa" });
  } catch (error) {
    console.error("Error en health check de PostgreSQL:", error);
    res.status(503).json({ status: "ERROR", message: "Base de datos no disponible" });
  }
});

const PORT = process.env.PORT || 4000;

const startServer = async () => {
  try {
    assertStorageConfig();
    await initDatabase();

    app.listen(PORT, () => {
      console.log(`Servidor corriendo en puerto ${PORT} - http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error("❌ Error iniciando el servidor:", error);
    process.exit(1);
  }
};

startServer();
