export {};

const fs = require("fs");
const pool = require("../config/db");
const { resolveStoredUploadPath } = require("../config/storage");

const servePrivateFile = async (req: any, res: any, next: any) => {
  const folder = String(req.params.folder || "");
  const filename = String(req.params.filename || "");
  const userId = Number(req.user?.id);
  const role = String(req.user?.rol || "").toLowerCase();

  if (!["cedulas", "selfies"].includes(folder) || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(filename)) {
    return res.status(404).json({ error: "Archivo no encontrado" });
  }

  try {
    if (!["admin", "operativo"].includes(role)) {
      const suffix = `/api/private-files/${folder}/${filename}`;
      const column = folder === "cedulas" ? "cedula_url" : "selfie_cedula_url";
      const access = await pool.query(
        `SELECT 1 FROM usuarios
         WHERE id = $1 AND RIGHT(COALESCE(${column}, ''), LENGTH($2)) = $2
         LIMIT 1`,
        [userId, suffix]
      );
      if (!access.rowCount) return res.status(404).json({ error: "Archivo no encontrado" });
    }

    const filePath = resolveStoredUploadPath(`${folder}/${filename}`);
    await fs.promises.access(filePath, fs.constants.R_OK);
    res.set({
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    });
    return res.sendFile(filePath, (error: any) => {
      if (!error) return;
      if (res.headersSent) return next(error);
      if (error.code === "ENOENT") return res.status(404).json({ error: "Archivo no encontrado" });
      console.error("Error entregando documento privado:", error);
      return res.status(500).json({ error: "No se pudo entregar el archivo" });
    });
  } catch (error: any) {
    if (error.code === "ENOENT") return res.status(404).json({ error: "Archivo no encontrado" });
    console.error("Error validando acceso a documento privado:", error);
    return res.status(500).json({ error: "No se pudo entregar el archivo" });
  }
};

module.exports = { servePrivateFile };
