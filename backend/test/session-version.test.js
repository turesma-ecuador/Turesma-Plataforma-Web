const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const jwt = require("jsonwebtoken");

process.env.JWT_SECRET = "session-version-test-secret";

let sessionVersion = 0;
const pool = {
  async query(sql) {
    assert.match(sql.replace(/\s+/g, " ").trim().toLowerCase(), /^select session_version from usuarios/);
    return { rows: [{ session_version: sessionVersion }], rowCount: 1 };
  },
};

const databaseModule = require.resolve("../dist/config/db");
require.cache[databaseModule] = {
  id: databaseModule,
  filename: databaseModule,
  loaded: true,
  exports: pool,
  children: [],
  paths: [],
};

const { verifyToken } = require("../dist/middleware/auth.middleware");
const app = express();
app.get("/protected", verifyToken, (_req, res) => res.status(200).json({ ok: true }));

let server;
let baseUrl;
const tokenFor = (version) => jwt.sign(
  { id: 12, email: "client@example.invalid", rol: "cliente", session_version: version },
  process.env.JWT_SECRET
);

test("la versión de sesión revoca tokens existentes después de una recuperación", async (t) => {
  await new Promise((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  t.after(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));

  const request = async (token) => fetch(`${baseUrl}/protected`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  const oldToken = tokenFor(0);
  assert.equal((await request(oldToken)).status, 200);

  sessionVersion = 1;
  assert.equal((await request(oldToken)).status, 401);
  assert.equal((await request(tokenFor(1))).status, 200);
});
