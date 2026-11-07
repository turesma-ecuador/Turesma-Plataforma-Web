const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const uploadsDir = fs.mkdtempSync(path.join(os.tmpdir(), "turesma-private-files-"));
process.env.UPLOADS_DIR = uploadsDir;
process.env.API_PUBLIC_URL = "https://api.turesma.test";

let canAccessOwnerFile = true;
const databaseModule = require.resolve("../dist/config/db");
require.cache[databaseModule] = {
  id: databaseModule,
  filename: databaseModule,
  loaded: true,
  exports: {
    query: async () => ({ rowCount: canAccessOwnerFile ? 1 : 0 }),
  },
};

const { servePrivateFile } = require("../dist/controllers/private-files.controller");
const filename = "private-document.webp";
const storedFilePath = path.join(uploadsDir, "cedulas", filename);
fs.mkdirSync(path.dirname(storedFilePath), { recursive: true });
fs.writeFileSync(storedFilePath, "private content");

const createResponse = () => ({
  statusCode: 200,
  body: null,
  headers: {},
  filePath: null,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(body) {
    this.body = body;
    return this;
  },
  set(headers) {
    this.headers = { ...this.headers, ...headers };
    return this;
  },
  sendFile(filePath, callback) {
    this.filePath = filePath;
    if (callback) callback();
    return this;
  },
});

test("el titular puede ver su documento privado sin caché pública", async () => {
  canAccessOwnerFile = true;
  const response = createResponse();
  await servePrivateFile(
    { params: { folder: "cedulas", filename }, user: { id: 21, rol: "cliente" } },
    response,
    (error) => { throw error; }
  );

  assert.equal(response.filePath, storedFilePath);
  assert.equal(response.headers["Cache-Control"], "private, no-store");
});

test("un usuario no puede ver el documento privado de otro usuario", async () => {
  canAccessOwnerFile = false;
  const response = createResponse();
  await servePrivateFile(
    { params: { folder: "cedulas", filename }, user: { id: 22, rol: "cliente" } },
    response,
    (error) => { throw error; }
  );

  assert.equal(response.statusCode, 404);
  assert.equal(response.filePath, null);
});

test("rechaza carpetas o nombres de archivo inseguros", async () => {
  const response = createResponse();
  await servePrivateFile(
    { params: { folder: "cedulas", filename: "../secret.txt" }, user: { id: 21, rol: "cliente" } },
    response,
    (error) => { throw error; }
  );

  assert.equal(response.statusCode, 404);
  assert.equal(response.filePath, null);
});

test.after(() => {
  fs.rmSync(uploadsDir, { recursive: true, force: true });
});
