export {};

const rateLimit = require("express-rate-limit");

const authenticatedSessionRoutes = new Set([
  "GET /me",
  "PUT /me",
  "POST /activity",
  "POST /logout",
]);

const hasAuthenticatedSessionRoute = (req: any) =>
  authenticatedSessionRoutes.has(`${req.method} ${req.path}`)
  && String(req.headers.authorization || "").startsWith("Bearer ");

const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
  skip: hasAuthenticatedSessionRoute,
  message: { error: "Demasiados intentos. Espera unos minutos e inténtalo de nuevo." },
});

module.exports = { authRateLimit };
