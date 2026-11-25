const assert = require("node:assert/strict");
const test = require("node:test");

const queries = [];
const pool = {
  async query(sql, params) {
    queries.push({ sql, params });
    return { rows: [{ preferred_language: params[0] }], rowCount: 1 };
  },
};

const installMock = (specifier, exports) => {
  const id = require.resolve(specifier);
  require.cache[id] = { id, filename: id, loaded: true, exports, children: [], paths: [] };
};

installMock("../dist/config/db", pool);
const { updateLanguagePreference } = require("../dist/controllers/auth.controller");

const response = () => ({
  statusCode: 200,
  body: null,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});

test("solo acepta y guarda preferencias de idioma es/en", async () => {
  const invalidResponse = response();
  await updateLanguagePreference(
    { user: { id: 21 }, body: { language: "fr" } },
    invalidResponse
  );
  assert.equal(invalidResponse.statusCode, 400);
  assert.equal(queries.length, 0);

  const validResponse = response();
  await updateLanguagePreference(
    { user: { id: 21 }, body: { language: "en" } },
    validResponse
  );
  assert.equal(validResponse.statusCode, 200);
  assert.deepEqual(validResponse.body, { preferred_language: "en" });
  assert.deepEqual(queries[0].params, ["en", 21]);
  assert.match(queries[0].sql, /preferred_language = \$1/i);
});
