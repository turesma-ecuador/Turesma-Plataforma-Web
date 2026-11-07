const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const sharp = require("sharp");

const uploadsDir = fs.mkdtempSync(path.join(os.tmpdir(), "turesma-storage-"));
process.env.UPLOADS_DIR = uploadsDir;
process.env.API_PUBLIC_URL = "https://api.turesma.test";

const storage = require("../dist/config/storage");

test("guarda medios públicos en disco y crea una URL de la API", async () => {
  const png = await sharp({ create: { width: 1, height: 1, channels: 3, background: "#ff0000" } }).png().toBuffer();
  const url = await storage.uploadImage({ buffer: png }, "perfiles");
  const filePath = storage.resolveStoredUploadPath(storage.getStoragePathFromUrl(url));

  assert.match(url, /^https:\/\/api\.turesma\.test\/uploads\/perfiles\/[a-f0-9-]+\.webp$/);
  assert.equal(fs.existsSync(filePath), true);
  await storage.deleteImage(storage.getStoragePathFromUrl(url));
  assert.equal(fs.existsSync(filePath), false);
});

test("guarda documentos de identidad bajo una URL autenticada no pública", async () => {
  const png = await sharp({ create: { width: 1, height: 1, channels: 3, background: "#0000ff" } }).png().toBuffer();
  const url = await storage.uploadImage({ buffer: png }, "cedulas");
  const relativePath = storage.getStoragePathFromUrl(url);

  assert.match(url, /^https:\/\/api\.turesma\.test\/api\/private-files\/cedulas\/[a-f0-9-]+\.webp$/);
  assert.equal(fs.existsSync(storage.resolveStoredUploadPath(relativePath)), true);
});

test("rechaza rutas de archivo fuera del directorio configurado", () => {
  assert.throws(() => storage.resolveStoredUploadPath("../secret.txt"), /Ruta de archivo no válida/);
  assert.throws(() => storage.resolveStoredUploadPath("perfiles/../../secret.txt"), /Ruta de archivo no válida/);
});

test.after(() => {
  fs.rmSync(uploadsDir, { recursive: true, force: true });
});
