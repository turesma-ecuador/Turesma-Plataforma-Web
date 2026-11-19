const assert = require("node:assert/strict");
const test = require("node:test");

const sentEmails = [];
const proformaPdf = Buffer.from("%PDF-test");
const recipient = { nombre: "Ana <Cliente>", email: "ana@example.invalid" };
const fakePool = {
  async query(sql, params) {
    assert.match(sql.toLowerCase(), /from usuarios/);
    assert.deepEqual(params, [7]);
    return { rows: [recipient], rowCount: 1 };
  },
};

const installMock = (specifier, exports) => {
  const id = require.resolve(specifier);
  require.cache[id] = {
    id,
    filename: id,
    loaded: true,
    exports,
    children: [],
    paths: [],
  };
};

const emailTemplate = require("../dist/config/emailTemplate");
installMock("../dist/config/db", fakePool);
installMock("../dist/config/mailer", {
  async enviarCorreo(email) {
    sentEmails.push(email);
    return { sent: true };
  },
});
installMock("../dist/config/emailTemplate", {
  ...emailTemplate,
  getWebBaseUrl: () => "https://turesma.example",
  getBrandedEmailLogoAttachment: () => ({ filename: "logo.png", cid: "turesma-logo" }),
});
installMock("../dist/config/proforma", {
  async buildProformaDataRequerimiento(id, usuarioId) {
    assert.equal(id, 44);
    assert.equal(usuarioId, 7);
    return { numero: "REQ-44" };
  },
  async generarProformaPDF(data) {
    assert.equal(data.numero, "REQ-44");
    return proformaPdf;
  },
});

const {
  notificarRespuestaRequerimiento,
  notificarPropuestaRequerimiento,
} = require("../dist/config/requerimientoMailer");

test("envía la respuesta administrativa por correo y enlaza el requerimiento del cliente", async () => {
  const result = await notificarRespuestaRequerimiento({
    id: 44,
    usuario_id: 7,
    respuesta_admin: "Servicio disponible <confirmado>.",
  });

  assert.deepEqual(result, { sent: true });
  assert.equal(sentEmails.length, 1);
  assert.match(sentEmails[0].subject, /respondió tu requerimiento #44/i);
  assert.match(sentEmails[0].html, /Servicio disponible &lt;confirmado&gt;\./);
  assert.match(sentEmails[0].text, /\/cliente\/requerimiento-personalizado/);
});

test("envía al cliente el total y los subtotales de su propuesta personalizada", async () => {
  const result = await notificarPropuestaRequerimiento({
    id: 44,
    usuario_id: 7,
    precio_final: 3400,
    respuesta_admin: "Incluye coordinación <especial>.",
    service_groups: [
      {
        cantidad_vehiculos: 2,
        tipo_vehiculo: "Bus",
        origen: "Manta",
        destino: "Quito",
        fecha_servicio: "2026-11-10",
        hora_salida: "08:30",
        precio_total: 2500,
      },
      {
        cantidad_vehiculos: 1,
        tipo_vehiculo: "SUV",
        origen: "Manta",
        destino: "Montecristi",
        fecha_servicio: "2026-11-10",
        precio_total: 900,
      },
    ],
  });

  assert.deepEqual(result, { sent: true });
  assert.deepEqual(result, { sent: true });
  assert.equal(sentEmails.length, 2);
  assert.equal(sentEmails[1].to, recipient.email);
  assert.match(sentEmails[1].subject, /propuesta.*requerimiento #44/i);
  assert.match(sentEmails[1].html, /Hola <strong>Ana &lt;Cliente&gt;<\/strong>/);
  assert.match(sentEmails[1].html, /Manta → Quito/);
  assert.match(sentEmails[1].html, /\$2500\.00/);
  assert.match(sentEmails[1].html, /\$900\.00/);
  assert.match(sentEmails[1].html, /\$3400\.00/);
  assert.match(sentEmails[1].html, /Incluye coordinación &lt;especial&gt;\./);
  assert.match(sentEmails[1].html, /https:\/\/turesma\.example\/cliente\/requerimiento-personalizado/);
  assert.equal(sentEmails[1].attachments[0].cid, "turesma-logo");
  assert.equal(sentEmails[1].attachments[1].filename, "Proforma-REQ-44.pdf");
  assert.deepEqual(sentEmails[1].attachments[1].content, proformaPdf);
  assert.match(sentEmails[1].text, /Total de la propuesta: \$3400\.00/);
});
