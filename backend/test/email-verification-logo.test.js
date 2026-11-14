const assert = require("node:assert/strict");
const test = require("node:test");

const state = { sent: [] };
const pool = { async query() { return { rows: [], rowCount: 0 }; } };
const mailer = {
  async enviarCorreo(email) {
    state.sent.push(email);
    return { sent: true };
  },
};

const installMock = (specifier, exports) => {
  const id = require.resolve(specifier);
  require.cache[id] = { id, filename: id, loaded: true, exports, children: [], paths: [] };
};

installMock("../dist/config/db", pool);
installMock("../dist/config/mailer", mailer);

const { sendEmailVerification } = require("../dist/config/emailVerification");

test("incluye el logo inline en el correo de verificación", async () => {
  state.sent.length = 0;
  await sendEmailVerification("cliente@example.invalid", "Cliente", "token-de-prueba");

  assert.equal(state.sent.length, 1);
  assert.match(state.sent[0].html, /src="cid:turesma-logo"/);
  assert.equal(state.sent[0].attachments.length, 1);
  assert.equal(state.sent[0].attachments[0].cid, "turesma-logo");
  assert.equal(state.sent[0].attachments[0].filename, "turesma-logo.png");
});
