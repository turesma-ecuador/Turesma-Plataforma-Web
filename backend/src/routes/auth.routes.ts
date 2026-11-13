export {};

const express = require("express");
const {
  login,
  register,
  forgotPassword,
  resetPassword,
  getMe,
  updateMe,
  recordSessionActivity,
  logout,
} = require("../controllers/auth.controller");
const { uploadPerfilImagen } = require("../controllers/uploads.controller");
const { verifyToken } = require("../middleware/auth.middleware");
const { verifyEmailToken } = require("../config/emailVerification");

const router = express.Router();

router.post("/register", register);
router.get("/verify-email", async (req, res) => {
  try {
    const verified = await verifyEmailToken(typeof req.query.token === "string" ? req.query.token : "");
    if (!verified) return res.status(400).json({ error: "El enlace no es válido o ya expiró" });
    return res.status(200).json({
      message: "Correo verificado correctamente. Si confirmaste un cambio de correo, ya puedes iniciar sesión con el nuevo correo.",
    });
  } catch (error) {
    if ((error as any)?.code === "23505") {
      return res.status(409).json({ error: "Ese correo ya está asociado a otra cuenta. Contacta al administrador." });
    }
    console.error("Error verificando correo:", error);
    return res.status(500).json({ error: "No se pudo verificar el correo" });
  }
});
router.post("/login", login);
router.post("/forgot-password", forgotPassword);
router.post("/reset-password", resetPassword);
router.post("/upload-perfil", uploadPerfilImagen);
router.get("/me", verifyToken, getMe);
router.put("/me", verifyToken, updateMe);
router.post("/activity", verifyToken, recordSessionActivity);
router.post("/logout", verifyToken, logout);

module.exports = router;
