const assert = require("node:assert/strict");
const test = require("node:test");

const calls = [];
const pool = {
  async query(sql, params) {
    calls.push({ sql, params });
    return { rowCount: 1 };
  },
};

const id = require.resolve("../dist/config/db");
require.cache[id] = { id, filename: id, loaded: true, exports: pool, children: [], paths: [] };
const { crearNotificacion } = require("../dist/config/notificaciones");

test("guarda el texto en inglés solo si el destinatario lo prefiere", async () => {
  const sent = await crearNotificacion(1, 2, "Texto en español", 7, "reserva", 7, "English text");

  assert.equal(sent, true);
  assert.match(calls[0].sql, /preferred_language/i);
  assert.match(calls[0].sql, /WHEN[\s\S]*= 'en'[\s\S]*THEN \$7[\s\S]*ELSE \$3/i);
  assert.deepEqual(calls[0].params, [1, 2, "Texto en español", 7, "reserva", 7, "English text"]);
});

test("mantiene el texto español como alternativa si no hay traducción", async () => {
  await crearNotificacion(1, 2, "Texto en español");

  assert.equal(calls[1].params[2], "Texto en español");
  assert.equal(calls[1].params[6], null);
});
