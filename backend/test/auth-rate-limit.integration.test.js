const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { authRateLimit } = require("../dist/middleware/auth-rate-limit.middleware");

const app = express();
app.use("/api/auth", authRateLimit);
app.post("/api/auth/login", (_req, res) => res.sendStatus(200));
app.get("/api/auth/me", (_req, res) => res.sendStatus(200));

test("un token Bearer no evita el límite de intentos en login", async (t) => {
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));

  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const headers = { Authorization: "Bearer token-invalido" };
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const response = await fetch(`${baseUrl}/api/auth/login`, { method: "POST", headers });
    assert.equal(response.status, 200);
  }

  const limitedLogin = await fetch(`${baseUrl}/api/auth/login`, { method: "POST", headers });
  assert.equal(limitedLogin.status, 429);

  const sessionCheck = await fetch(`${baseUrl}/api/auth/me`, { headers });
  assert.equal(sessionCheck.status, 200);
});
