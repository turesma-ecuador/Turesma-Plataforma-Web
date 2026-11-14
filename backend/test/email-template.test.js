const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const { getBrandedEmailLogoAttachment, renderBrandedEmail } = require("../dist/config/emailTemplate");

test("renderiza el correo de marca con logo incrustado y contenido seguro", () => {
  const previousWebUrl = process.env.WEB_URL;
  process.env.WEB_URL = "https://turesma.example/";

  try {
    const html = renderBrandedEmail({
      preheader: "Confirma tu cuenta",
      title: "Confirma tu correo",
      bodyHtml: "<p>Mensaje de prueba</p>",
      actionLabel: "Confirmar",
      actionUrl: "https://turesma.example/verificar?token=abc&next=home",
      notice: "El enlace expira pronto.",
    });

    assert.match(html, /src="cid:turesma-logo"/);
    assert.doesNotMatch(html, /https:\/\/turesma\.example\/logo\.png/);
    assert.match(html, /alt="Turesma S\.A\. - Transporte turístico"/);
    assert.match(html, /href="https:\/\/turesma\.example\/verificar\?token=abc&amp;next=home"/);
    assert.match(html, /Mensaje de prueba/);
  } finally {
    if (previousWebUrl === undefined) delete process.env.WEB_URL;
    else process.env.WEB_URL = previousWebUrl;
  }
});

test("adjunta el logo como imagen inline del correo", () => {
  const attachment = getBrandedEmailLogoAttachment();

  assert.equal(attachment.cid, "turesma-logo");
  assert.equal(attachment.filename, "turesma-logo.png");
  assert.equal(fs.existsSync(attachment.path), true);
});
