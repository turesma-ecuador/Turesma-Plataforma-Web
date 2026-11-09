const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeIdentification } = require("../dist/config/identificacion");

test("valida y normaliza cédula, pasaporte y RUC", () => {
  assert.deepEqual(normalizeIdentification("cedula", "1710034065"), {
    type: "cedula",
    value: "1710034065",
    error: null,
  });
  assert.deepEqual(normalizeIdentification("pasaporte", "ab-123456"), {
    type: "pasaporte",
    value: "AB123456",
    error: null,
  });
  assert.deepEqual(normalizeIdentification("ruc", "1790016919001"), {
    type: "ruc",
    value: "1790016919001",
    error: null,
  });
});

test("rechaza identificaciones inválidas", () => {
  assert.match(normalizeIdentification("cedula", "1710034066").error, /cédula/i);
  assert.match(normalizeIdentification("pasaporte", "AB-1").error, /pasaporte/i);
  assert.match(normalizeIdentification("ruc", "1790016918001").error, /RUC/i);
  assert.match(normalizeIdentification("otro", "1234567890").error, /tipo/i);
});
