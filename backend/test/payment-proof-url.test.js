const test = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");

process.env.API_PUBLIC_URL = "https://api.example.invalid";
process.env.JWT_SECRET = "payment-proof-url-test-secret";

const dbModule = require.resolve("../dist/config/db");
require.cache[dbModule] = {
  id: dbModule,
  filename: dbModule,
  loaded: true,
  exports: { async query() { return { rows: [], rowCount: 0 }; } },
  children: [],
  paths: [],
};

const { crearUrlAccesoComprobante } = require("../dist/config/comprobanteAcceso");

test("renueva un enlace de comprobante vencido al listar un pago", () => {
  const url = crearUrlAccesoComprobante(
    "https://legacy-api.example.invalid/api/usuarios/comprobantes/comprobante-123-456.jpg?token=old",
    17
  );
  const parsedUrl = new URL(url);
  const token = parsedUrl.searchParams.get("token");

  assert.equal(parsedUrl.origin, "https://api.example.invalid");
  assert.equal(parsedUrl.pathname, "/api/usuarios/comprobantes/comprobante-123-456.jpg");
  assert.ok(token);
  assert.deepEqual(jwt.verify(token, process.env.JWT_SECRET), {
    file: "comprobante-123-456.jpg",
    uid: 17,
    iat: jwt.decode(token).iat,
    exp: jwt.decode(token).exp,
  });
});

test("no crea enlaces para rutas que no son comprobantes", () => {
  assert.equal(crearUrlAccesoComprobante("https://api.example.invalid/uploads/perfiles/avatar.webp", 17), null);
});
