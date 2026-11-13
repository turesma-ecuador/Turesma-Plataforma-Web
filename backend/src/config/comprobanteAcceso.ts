export {};

const jwt = require("jsonwebtoken");
const { JWT_SECRET } = require("../middleware/auth.middleware");
const { getApiPublicUrl } = require("./storage");

const crearUrlAccesoComprobante = (storedUrl: string, userId: number) => {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(String(storedUrl), `${getApiPublicUrl()}/`);
  } catch {
    return null;
  }

  const marker = "/comprobantes/";
  const markerIndex = parsedUrl.pathname.lastIndexOf(marker);
  if (markerIndex < 0) return null;

  let filename: string;
  try {
    filename = decodeURIComponent(parsedUrl.pathname.slice(markerIndex + marker.length));
  } catch {
    return null;
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*\.(?:jpe?g|png|webp)$/i.test(filename)) return null;

  const token = jwt.sign({ file: filename, uid: userId }, JWT_SECRET, { expiresIn: "15m" });
  const imageUrl = new URL(
    `/api/usuarios/comprobantes/${encodeURIComponent(filename)}`,
    `${getApiPublicUrl()}/`
  );
  imageUrl.searchParams.set("token", token);
  return imageUrl.toString();
};

module.exports = { crearUrlAccesoComprobante };
