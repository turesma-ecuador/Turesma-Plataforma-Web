const assert = require("node:assert/strict");
const test = require("node:test");

let reservation = {
  id: 42,
  origen: "Quito & Cumbayá",
  destino: "Otavalo",
  fecha_reserva: "2026-12-10",
  total: 180,
  usuario_id: 502,
  cliente_nombre: "Ana <img src=x onerror=alert(1)>",
  cliente_email: "ana@example.invalid",
  vehiculo_placa: "ABC-1234",
  vehiculo_modelo: "Van <ejecutiva>",
  vehiculo_imagen_url: "https://api.turesma.example/uploads/vehiculos/unit.webp?v=1&x=2",
  conductor_nombre: "Luis & Marco",
};
const sentEmails = [];
const inAppNotifications = [];
const operation = {
  id: 70,
  reserva_id: 42,
  requerimiento_id: 901,
  grupo_numero: 2,
  unidad_numero: 1,
  fecha_programada: "2026-12-10",
  origen: "Quito",
  destino: "Otavalo",
  estado: "asignada",
  usuario_id: 502,
  cliente_nombre: "Ana",
  cliente_email: "ana@example.invalid",
  vehiculo_placa: "XYZ-9876",
  vehiculo_modelo: "Van",
  vehiculo_imagen_url: "https://api.turesma.example/uploads/vehiculos/custom.webp",
  conductor_nombre: "Luis Pérez",
  conductor_usuario_id: 603,
};
const fakePool = {
  async query(sql, params) {
    if (sql.toLowerCase().includes("from operaciones o")) {
      assert.equal(params[0], operation.id);
      return { rows: [operation], rowCount: 1 };
    }
    assert.equal(params[0], reservation.id);
    return { rows: [reservation], rowCount: 1 };
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

installMock("../dist/config/db", fakePool);
installMock("../dist/config/mailer", {
  async enviarCorreo(email) {
    sentEmails.push(email);
    return { sent: true };
  },
});
installMock("../dist/config/notificaciones", {
  async crearNotificacion(...args) {
    inAppNotifications.push(args);
  },
  async notificarAdmins() {},
});

const { notificarClienteReserva, notificarClienteOperacion } = require("../dist/config/reservaMailer");

test("notifica la asignación y sus cambios con los datos del vehículo", async (t) => {
  const previousWebUrl = process.env.WEB_URL;
  process.env.WEB_URL = "https://turesma.example";
  t.after(() => {
    if (previousWebUrl === undefined) delete process.env.WEB_URL;
    else process.env.WEB_URL = previousWebUrl;
  });

  await notificarClienteReserva(42, "conductor_asignado", 99);

  assert.equal(sentEmails.length, 1);
  assert.equal(sentEmails[0].to, "ana@example.invalid");
  assert.match(sentEmails[0].subject, /vehículo y conductor asignados/i);
  assert.match(sentEmails[0].html, /src="https:\/\/api\.turesma\.example\/uploads\/vehiculos\/unit\.webp\?v=1&amp;x=2"/);
  assert.match(sentEmails[0].html, /ABC-1234 · Van &lt;ejecutiva&gt;/);
  assert.match(sentEmails[0].html, /Luis &amp; Marco/);
  assert.match(sentEmails[0].html, /https:\/\/turesma\.example\/cliente\/historial/);
  assert.match(sentEmails[0].html, /Ana &lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(sentEmails[0].html, /<img src=x onerror=alert\(1\)>/);
  assert.match(inAppNotifications[0][2], /ABC-1234.*Luis & Marco/);

  reservation = {
    ...reservation,
    vehiculo_placa: "XYZ-9876",
    vehiculo_modelo: "Bus ejecutivo",
    vehiculo_imagen_url: "https://api.turesma.example/uploads/vehiculos/replacement.webp",
    conductor_nombre: "María Pérez",
  };
  await notificarClienteReserva(42, "conductor_asignado", 99, true);

  assert.equal(sentEmails.length, 2);
  assert.match(sentEmails[1].subject, /actualizamos.*vehículo y conductor/i);
  assert.match(sentEmails[1].html, /XYZ-9876 · Bus ejecutivo/);
  assert.match(sentEmails[1].html, /replacement\.webp/);
  assert.match(inAppNotifications[1][2], /Actualizamos la asignación/);
});

test("notifica al cliente y al conductor al asignar una unidad personalizada", async () => {
  sentEmails.length = 0;
  inAppNotifications.length = 0;
  await notificarClienteOperacion(operation.id, 99, "asignada");

  assert.equal(sentEmails.length, 1);
  assert.equal(sentEmails[0].to, operation.cliente_email);
  assert.match(sentEmails[0].subject, /servicio personalizado asignada/i);
  assert.match(sentEmails[0].html, /XYZ-9876 · Van/);
  assert.match(sentEmails[0].html, /custom\.webp/);
  assert.equal(inAppNotifications.length, 2);
  assert.equal(inAppNotifications[0][1], operation.usuario_id);
  assert.equal(inAppNotifications[1][1], operation.conductor_usuario_id);
});
