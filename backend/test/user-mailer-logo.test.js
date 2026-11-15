const assert = require("node:assert/strict");
const test = require("node:test");

const sentEmails = [];

const installMock = (specifier, exports) => {
  const id = require.resolve(specifier);
  require.cache[id] = { id, filename: id, loaded: true, exports, children: [], paths: [] };
};

installMock("../dist/config/mailer", {
  async enviarCorreo(email) {
    sentEmails.push(email);
    return { sent: true };
  },
});

const {
  enviarCorreoBienvenida,
  enviarCorreoVerificacionAprobada,
} = require("../dist/config/usuarioMailer");

test("incluye logo inline y colores de marca en correos de bienvenida e identidad", async () => {
  await enviarCorreoBienvenida({
    email: "cliente@example.invalid",
    nombre: "Ana <script>alert(1)</script>",
  });
  await enviarCorreoVerificacionAprobada({
    email: "cliente@example.invalid",
    nombre: "Ana",
  });

  assert.equal(sentEmails.length, 2);
  for (const email of sentEmails) {
    assert.match(email.html, /src="cid:turesma-logo"/);
    assert.equal(email.attachments[0].cid, "turesma-logo");
    assert.match(email.html, /#E31E24/);
  }
  assert.match(sentEmails[1].html, /background-color:#f0fdf4/);
  assert.match(sentEmails[0].html, /Ana &lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(sentEmails[0].html, /<script>alert/);
});
