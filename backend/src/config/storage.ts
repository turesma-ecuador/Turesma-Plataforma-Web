export {};

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const sharp = require("sharp");

const publicFolders = new Set(["galeria", "perfiles", "vehiculos", "viajes", "videos"]);
const privateFolders = new Set(["cedulas", "selfies"]);
const storageFolders = new Set([...publicFolders, ...privateFolders]);
const imageExtensions = new Set([".webp"]);
const videoExtensions = new Set([".mp4", ".webm", ".mov"]);

const uploadsRoot = path.resolve(
  process.env.UPLOADS_DIR || path.join(__dirname, "../../uploads")
);

fs.mkdirSync(uploadsRoot, { recursive: true });

const getApiPublicUrl = () => {
  const configuredUrl = String(process.env.API_PUBLIC_URL || "").trim();
  if (!configuredUrl) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("API_PUBLIC_URL es obligatorio en producción para generar enlaces de archivos");
    }
    return `http://localhost:${process.env.PORT || 4000}`;
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(configuredUrl);
  } catch {
    throw new Error("API_PUBLIC_URL debe ser una URL absoluta válida");
  }

  if (
    !["http:", "https:"].includes(parsedUrl.protocol)
    || parsedUrl.pathname !== "/"
    || parsedUrl.search
    || parsedUrl.hash
    || (process.env.NODE_ENV === "production" && parsedUrl.protocol !== "https:")
  ) {
    throw new Error("API_PUBLIC_URL debe ser el origen HTTPS público de la API");
  }

  return parsedUrl.origin;
};

const assertStorageConfig = () => {
  getApiPublicUrl();
};

const safeFolder = (folder: string) => {
  if (!storageFolders.has(folder)) throw new Error("Carpeta de almacenamiento no válida");
  return folder;
};

const safeFilename = (filename: string) => {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(filename) || filename === "." || filename === "..") {
    throw new Error("Nombre de archivo no válido");
  }
  return filename;
};

const resolveStoredUploadPath = (storedPath: string) => {
  const normalizedPath = String(storedPath || "").replace(/^\/uploads\//, "");
  const segments = normalizedPath.split("/");
  if (
    !normalizedPath
    || normalizedPath.startsWith("/")
    || segments.some((segment: string) => !segment || segment === "." || segment === "..")
  ) {
    throw new Error("Ruta de archivo no válida");
  }

  const resolvedPath = path.resolve(uploadsRoot, normalizedPath);
  if (!resolvedPath.startsWith(`${uploadsRoot}${path.sep}`)) {
    throw new Error("Ruta de archivo fuera del almacenamiento permitido");
  }
  return resolvedPath;
};

const getStorageUrl = (folder: string, filename: string) => {
  safeFolder(folder);
  safeFilename(filename);
  const urlPath = privateFolders.has(folder)
    ? `/api/private-files/${folder}/${filename}`
    : `/uploads/${folder}/${filename}`;
  return new URL(urlPath, `${getApiPublicUrl()}/`).toString();
};

const storeBuffer = async (buffer: Buffer, folder: string, extension: string) => {
  safeFolder(folder);
  const normalizedExtension = extension.toLowerCase();
  const allowedExtensions = folder === "videos" ? videoExtensions : imageExtensions;
  if (!allowedExtensions.has(normalizedExtension)) {
    throw new Error("Formato de archivo no permitido para esta carpeta");
  }

  const filename = `${crypto.randomUUID()}${normalizedExtension}`;
  const filePath = resolveStoredUploadPath(`${folder}/${filename}`);
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  await fs.promises.writeFile(filePath, buffer, { flag: "wx" });
  return getStorageUrl(folder, filename);
};

const optimizeImage = async (buffer: Buffer, folder: string) => {
  const isDocument = folder === "cedulas";
  return sharp(buffer)
    .rotate()
    .resize({
      width: isDocument ? 1800 : folder === "perfiles" ? 800 : 1280,
      height: isDocument ? 1800 : folder === "perfiles" ? 800 : 1280,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: isDocument ? 88 : 82, effort: 4 })
    .toBuffer();
};

const uploadBuffer = async (buffer: Buffer, folder: string) => {
  const optimized = await optimizeImage(buffer, folder);
  return storeBuffer(optimized, folder, ".webp");
};

const uploadImage = async (file: any, folder: string) => {
  return uploadBuffer(file.buffer, folder);
};

const uploadVideo = async (file: any, folder = "videos") => {
  const originalName = String(file.originalname || "video.mp4");
  const extension = path.extname(originalName).toLowerCase();
  const safeExtension = videoExtensions.has(extension) ? extension : ".mp4";
  return storeBuffer(file.buffer, folder, safeExtension);
};

const getStoragePathFromUrl = (fileUrl: string) => {
  try {
    const parsedUrl = new URL(fileUrl, `${getApiPublicUrl()}/`);
    const publicMatch = parsedUrl.pathname.match(/^\/uploads\/([^/]+)\/([^/]+)$/);
    const privateMatch = parsedUrl.pathname.match(/^\/api\/private-files\/([^/]+)\/([^/]+)$/);
    const match = publicMatch || privateMatch;
    if (!match) return null;

    const folder = decodeURIComponent(match[1]);
    const filename = decodeURIComponent(match[2]);
    safeFolder(folder);
    safeFilename(filename);
    return `${folder}/${filename}`;
  } catch {
    return null;
  }
};

const deleteImage = async (storagePath: string) => {
  const segments = String(storagePath || "").split("/");
  if (segments.length !== 2) throw new Error("Ruta de almacenamiento no válida");
  const [folder, filename] = segments;
  safeFolder(folder);
  safeFilename(filename);
  const filePath = resolveStoredUploadPath(`${folder}/${filename}`);
  try {
    await fs.promises.unlink(filePath);
  } catch (error: any) {
    if (error.code !== "ENOENT") throw error;
  }
};

module.exports = {
  assertStorageConfig,
  deleteImage,
  getApiPublicUrl,
  getStoragePathFromUrl,
  getStorageUrl,
  getUploadsRoot: () => uploadsRoot,
  optimizeImage,
  resolveStoredUploadPath,
  storeBuffer,
  uploadBuffer,
  uploadImage,
  uploadVideo,
};
