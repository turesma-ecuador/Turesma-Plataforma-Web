const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const jwt = require("jsonwebtoken");

process.env.JWT_SECRET = "session-version-test-secret";

let sessionVersion = 0;
let now = Date.now();
const sessionId = "00000000-0000-4000-8000-000000000001";
const secondSessionId = "00000000-0000-4000-8000-000000000002";
const sessions = new Map([[sessionId, now]]);
const revokedSessions = new Set();
const pool = {
  async query(sql, params) {
    const query = sql.replace(/\s+/g, " ").trim().toLowerCase();
    if (query.startsWith("select session_version from usuarios")) {
      const [userId, requestedSessionId] = params;
      const lastActivityAt = sessions.get(requestedSessionId);
      if (
        Number(userId) !== 12
        || !lastActivityAt
        || revokedSessions.has(requestedSessionId)
        || now - lastActivityAt >= 5 * 60 * 1000
      ) {
        return { rows: [], rowCount: 0 };
      }
      return { rows: [{ session_version: sessionVersion }], rowCount: 1 };
    }
    if (query.startsWith("update auth_sessions set last_activity_at = now()")) {
      const [requestedSessionId, userId] = params;
      if (Number(userId) !== 12 || !sessions.has(requestedSessionId) || revokedSessions.has(requestedSessionId)) {
        return { rows: [], rowCount: 0 };
      }
      sessions.set(requestedSessionId, now);
      return { rows: [{ id: requestedSessionId }], rowCount: 1 };
    }
    if (query.startsWith("update auth_sessions set revoked_at = now()")) {
      const [requestedSessionId, userId] = params;
      if (Number(userId) === 12 && sessions.has(requestedSessionId)) revokedSessions.add(requestedSessionId);
      return { rows: [], rowCount: 1 };
    }
    throw new Error(`Unexpected authentication query: ${query}`);
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
const { recordSessionActivity, logout } = require("../dist/controllers/auth.controller");
const app = express();
app.get("/protected", verifyToken, (_req, res) => res.status(200).json({ ok: true }));
app.post("/activity", verifyToken, recordSessionActivity);
app.post("/logout", verifyToken, logout);

let server;
let baseUrl;
const tokenFor = (version, requestedSessionId = sessionId) => jwt.sign(
  {
    id: 12,
    email: "client@example.invalid",
    rol: "cliente",
    session_version: version,
    session_id: requestedSessionId,
  },
  process.env.JWT_SECRET
);

test("la versión y los cinco minutos de inactividad invalidan la sesión", async (t) => {
  await new Promise((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  t.after(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));

  const request = async (token) => fetch(`${baseUrl}/protected`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const sessionRequest = async (path, method, token) => fetch(`${baseUrl}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}` },
  });

  const oldToken = tokenFor(0);
  assert.equal((await request(oldToken)).status, 200);

  now += 4 * 60 * 1000 + 59 * 1000;
  assert.equal((await request(oldToken)).status, 200);
  const activityResponse = await sessionRequest("/activity", "POST", oldToken);
  assert.equal(activityResponse.status, 204);
  assert.equal(sessions.get(sessionId), now);

  now += 5 * 60 * 1000;
  assert.equal((await request(oldToken)).status, 401);

  sessionVersion = 1;
  assert.equal((await request(oldToken)).status, 401);
  sessions.set(secondSessionId, now);
  assert.equal((await request(tokenFor(1, secondSessionId))).status, 200);
  assert.equal((await request(tokenFor(1, "not-a-session-id"))).status, 401);

  const logoutToken = tokenFor(1, secondSessionId);
  assert.equal((await sessionRequest("/logout", "POST", logoutToken)).status, 204);
  assert.equal((await request(logoutToken)).status, 401);
});
