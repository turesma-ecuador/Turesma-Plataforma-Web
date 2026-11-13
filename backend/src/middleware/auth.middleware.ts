export {};

const jwt = require("jsonwebtoken");
const pool = require("../config/db");

const JWT_SECRET = process.env.JWT_SECRET || "turesma_secret_key_2026_seguro";
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "7d";
const SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Si no hay JWT_SECRET definido, el sistema usa una clave por defecto que está
// a la vista en el código: cualquiera podría falsificar tokens. En producción
// eso es inaceptable, así que se detiene el arranque; en desarrollo solo avisa.
if (!process.env.JWT_SECRET) {
  if (process.env.NODE_ENV === "production") {
    throw new Error("JWT_SECRET no está definido. Configúralo en las variables de entorno antes de desplegar.");
  }
  console.warn("⚠️  JWT_SECRET no está definido: usando clave por defecto SOLO para desarrollo. Define JWT_SECRET en tu archivo .env.");
}

const generateToken = (payload: {
  id: number;
  email: string;
  rol: string;
  session_version?: number;
  session_id: string;
}) => {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
};

const isSessionValid = async (decoded: any) => {
  const sessionId = typeof decoded.session_id === "string" ? decoded.session_id : "";
  if (!SESSION_ID_PATTERN.test(sessionId)) return false;

  const result = await pool.query(
    `SELECT session_version
     FROM usuarios
     WHERE id = $1
       AND activo = true
       AND EXISTS (
         SELECT 1
         FROM auth_sessions s
         WHERE s.id = $2::uuid
           AND s.user_id = usuarios.id
           AND s.revoked_at IS NULL
           AND s.last_activity_at > NOW() - INTERVAL '5 minutes'
       )
     LIMIT 1`,
    [decoded.id, sessionId]
  );

  return result.rows.length > 0
    && Number(result.rows[0].session_version || 0) === Number(decoded.session_version || 0);
};

const verifyToken = async (req: any, res: any, next: any) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Token de autenticación requerido" });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (!(await isSessionValid(decoded))) {
      return res.status(401).json({ error: "La sesión expiró por inactividad o ya no es válida. Inicia sesión nuevamente." });
    }
    req.user = decoded;
    next();
  } catch (error: any) {
    if (error?.name === "TokenExpiredError") {
      return res.status(401).json({ error: "Token expirado, inicia sesión nuevamente" });
    }
    if (error?.name === "JsonWebTokenError" || error?.name === "NotBeforeError") {
      return res.status(401).json({ error: "Token inválido" });
    }
    console.error("Error validando la sesión:", error);
    return res.status(500).json({ error: "No se pudo validar la sesión" });
  }
};

const requireRole = (...roles: string[]) => {
  return (req: any, res: any, next: any) => {
    if (!req.user) {
      return res.status(401).json({ error: "No autenticado" });
    }

    const userRole = String(req.user.rol || "").toLowerCase();
    const normalizedRoles = roles.map((r) => r.toLowerCase());

    if (!normalizedRoles.includes(userRole)) {
      return res.status(403).json({
        error: "No tienes permisos para acceder a este recurso",
      });
    }

    next();
  };
};

const requireSelfOrRole = (...roles: string[]) => {
  const normalizedRoles = roles.map((role) => role.toLowerCase());

  return (req: any, res: any, next: any) => {
    if (!req.user) {
      return res.status(401).json({ error: "No autenticado" });
    }

    const currentId = Number(req.user.id);
    const requestedId = Number(req.params.id);
    const currentRole = String(req.user.rol || "").toLowerCase();

    if (normalizedRoles.includes(currentRole) || currentId === requestedId) {
      return next();
    }

    return res.status(403).json({ error: "No puedes acceder a recursos de otro usuario" });
  };
};

const optionalAuth = async (req: any, res: any, next: any) => {
  const authHeader = req.headers.authorization;

  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.split(" ")[1];
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      if (await isSessionValid(decoded)) req.user = decoded;
    } catch (error: any) {
      if (error?.name !== "JsonWebTokenError" && error?.name !== "TokenExpiredError" && error?.name !== "NotBeforeError") {
        console.error("Error validando sesión opcional:", error);
        return res.status(500).json({ error: "No se pudo validar la sesión" });
      }
    }
  }

  next();
};

module.exports = {
  generateToken,
  verifyToken,
  requireRole,
  requireSelfOrRole,
  optionalAuth,
  JWT_SECRET,
};
