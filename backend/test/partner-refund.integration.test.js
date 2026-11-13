const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const jwt = require("jsonwebtoken");

process.env.JWT_SECRET = "partner-refund-integration-test-secret";

const state = {
  companies: [],
  vehicles: [],
  refunds: [],
  reservation: { id: 501, total: 80, estado: "confirmada", monto_pagado: 80, estado_pago: "pagado" },
  payment: { id: 601, reserva_id: 501, usuario_id: 77, monto: 80, estado: "aprobado" },
  nextCompanyId: 1,
  nextVehicleId: 1,
  nextRefundId: 1,
  companyServices: 0,
  vehicleServices: 0,
};

const result = (rows = []) => ({ rows, rowCount: rows.length });
const pool = {
  async query(sql, params = []) {
    const query = sql.replace(/\s+/g, " ").trim().toLowerCase();
    if (query.startsWith("select session_version from usuarios")) return result([{ session_version: 0 }]);
    if (query.startsWith("insert into mensajes_comunicacion")) return result();
    if (query.startsWith("select * from empresas_asociadas")) return result(state.companies);
    if (query.startsWith("select * from vehiculos_asociados")) return result(state.vehicles);
    if (query.startsWith("insert into empresas_asociadas")) {
      const company = {
        id: state.nextCompanyId++,
        nombre: params[0],
        identificacion: params[1],
        contacto: params[2],
        telefono: params[3],
        email: params[4],
        notas: params[5],
        activa: true,
      };
      state.companies.push(company);
      return result([company]);
    }
    if (query.startsWith("select id, activa from empresas_asociadas")) {
      const company = state.companies.find((row) => row.id === Number(params[0]));
      return result(company ? [company] : []);
    }
    if (query.startsWith("update empresas_asociadas set nombre = coalesce")) {
      const company = state.companies.find((row) => row.id === Number(params[12]));
      if (!company) return result();
      Object.assign(company, { activa: params[11] === null ? company.activa : params[11] });
      return result([company]);
    }
    if (query.startsWith("insert into vehiculos_asociados")) {
      const vehicle = {
        id: state.nextVehicleId++,
        empresa_id: Number(params[0]),
        placa: params[1],
        modelo: params[2],
        capacidad: params[3],
        conductor: params[4],
        conductor_telefono: params[5],
        activo: true,
      };
      state.vehicles.push(vehicle);
      return result([vehicle]);
    }
    throw new Error(`Unexpected pool query: ${query}`);
  },
  async connect() {
    return {
      async query(sql, params = []) {
        const query = sql.replace(/\s+/g, " ").trim().toLowerCase();
        if (["begin", "commit", "rollback"].includes(query)) return result();
        if (query.startsWith("select id from empresas_asociadas where id = $1 for update")) {
          const company = state.companies.find((row) => row.id === Number(params[0]));
          return result(company ? [company] : []);
        }
        if (query.startsWith("select count(distinct o.id)::int as servicios_afectados")) {
          return result([{ servicios_afectados: state.companyServices }]);
        }
        if (query.startsWith("select id from vehiculos_asociados where id = $1 for update")) {
          const vehicle = state.vehicles.find((row) => row.id === Number(params[0]));
          return result(vehicle ? [vehicle] : []);
        }
        if (query.startsWith("select count(*)::int as servicios_afectados from operaciones")) {
          return result([{ servicios_afectados: state.vehicleServices }]);
        }
        if (query.startsWith("update empresas_asociadas set nombre = coalesce")) {
          const company = state.companies.find((row) => row.id === Number(params[11]));
          if (!company) return result();
          Object.assign(company, { activa: false });
          return result([company]);
        }
        if (query.startsWith("update vehiculos_asociados set placa = coalesce")) {
          const vehicle = state.vehicles.find((row) => row.id === Number(params[7]));
          if (!vehicle) return result();
          Object.assign(vehicle, { activo: false });
          return result([vehicle]);
        }
        if (query.startsWith("select p.id, p.reserva_id, p.usuario_id, p.monto, p.estado, r.total")) {
          return result([{
            ...state.payment,
            total: state.reservation.total,
            reserva_estado: state.reservation.estado,
          }]);
        }
        if (query.startsWith("select coalesce(sum(monto), 0) as total from reembolsos_reserva where pago_id")) {
          const total = state.refunds.filter((refund) => refund.pago_id === Number(params[0]) && ["pendiente", "completado"].includes(refund.estado)).reduce((sum, refund) => sum + refund.monto, 0);
          return result([{ total }]);
        }
        if (query.startsWith("select coalesce((select sum(monto) from pagos_reserva")) {
          const totalRefunded = state.refunds.filter((refund) => refund.reserva_id === Number(params[0]) && refund.estado === "completado").reduce((sum, refund) => sum + refund.monto, 0);
          const pending = state.refunds.filter((refund) => refund.reserva_id === Number(params[0]) && refund.estado === "pendiente").reduce((sum, refund) => sum + refund.monto, 0);
          const gross = state.payment.reserva_id === Number(params[0]) ? state.payment.monto : 0;
          return result([{ neto: gross - totalRefunded, pendiente: pending, devuelto: totalRefunded }]);
        }
        if (query.startsWith("insert into reembolsos_reserva")) {
          const refund = {
            id: state.nextRefundId++,
            pago_id: Number(params[0]),
            reserva_id: Number(params[1]),
            monto: Number(params[2]),
            motivo: params[3],
            referencia_externa: null,
            estado: "pendiente",
          };
          state.refunds.push(refund);
          return result([refund]);
        }
        if (query.startsWith("select rr.id, rr.pago_id, rr.reserva_id, rr.monto, rr.estado")) {
          const refund = state.refunds.find((row) => row.id === Number(params[0]));
          return result(refund ? [{
            ...refund,
            usuario_id: state.payment.usuario_id,
            pago_estado: state.payment.estado,
            reserva_estado: state.reservation.estado,
            total: state.reservation.total,
          }] : []);
        }
        if (query.startsWith("update reembolsos_reserva set estado = 'completado'")) {
          const refund = state.refunds.find((row) => row.id === Number(params[2]));
          if (!refund) return result();
          Object.assign(refund, { estado: "completado", referencia_externa: params[0] });
          return result([refund]);
        }
        if (query.startsWith("update reservas set monto_pagado = $1")) {
          Object.assign(state.reservation, { monto_pagado: Number(params[0]), estado_pago: params[1] });
          return result();
        }
        if (query.startsWith("insert into reserva_historial")) return result();
        throw new Error(`Unexpected transaction query: ${query}`);
      },
      release() {},
    };
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

const adminRoutes = require("../dist/routes/admin.routes");
const app = express();
app.use(express.json());
app.use("/api/admin", adminRoutes);
const tokenForRole = (rol) => jwt.sign({
  id: 99,
  email: `${rol}@example.invalid`,
  rol,
  session_id: "00000000-0000-4000-8000-000000000001",
}, process.env.JWT_SECRET);

let server;
let baseUrl;

test("administra empresas asociadas y gestiona devoluciones manuales con permisos y controles", async (t) => {
  await new Promise((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  t.after(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));

  const request = async (path, role, options = {}) => {
    const response = await fetch(`${baseUrl}/api/admin${path}`, {
      ...options,
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        Authorization: `Bearer ${tokenForRole(role)}`,
        ...options.headers,
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    return { status: response.status, body: await response.json() };
  };

  await t.test("permite consultar el directorio a operaciones y reserva cambios a administración", async () => {
    assert.equal((await request("/empresas-asociadas", "operativo")).status, 200);
    assert.equal((await request("/empresas-asociadas", "operativo", {
      method: "POST",
      body: { nombre: "Transporte de prueba" },
    })).status, 403);
    const created = await request("/empresas-asociadas", "admin", {
      method: "POST",
      body: { nombre: "Transporte de prueba", contacto: "Contacto", telefono: "0990000000" },
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.data.nombre, "Transporte de prueba");
    const vehicle = await request(`/empresas-asociadas/${created.body.data.id}/vehiculos`, "admin", {
      method: "POST",
      body: { placa: "ABC-1234", modelo: "Van", capacidad: 12, conductor: "Conductor", conductor_telefono: "0990000000" },
    });
    assert.equal(vehicle.status, 201);
    const invalidVehicle = await request(`/empresas-asociadas/${created.body.data.id}/vehiculos`, "admin", {
      method: "POST",
      body: { placa: "ABC-1234", modelo: "Van", capacidad: 0 },
    });
    assert.equal(invalidVehicle.status, 400);

    state.companyServices = 2;
    const companyWarning = await request(`/empresas-asociadas/${created.body.data.id}`, "admin", {
      method: "PATCH",
      body: { activa: false },
    });
    assert.equal(companyWarning.status, 409);
    assert.equal(companyWarning.body.confirmacion_requerida, true);
    assert.equal(companyWarning.body.servicios_afectados, 2);
    assert.equal(state.companies[0].activa, true);

    state.companyServices = 3;
    const changedCompanyWarning = await request(`/empresas-asociadas/${created.body.data.id}`, "admin", {
      method: "PATCH",
      body: { activa: false, confirmar_servicios_afectados: true, servicios_afectados_confirmados: 2 },
    });
    assert.equal(changedCompanyWarning.status, 409);
    assert.equal(changedCompanyWarning.body.servicios_afectados, 3);

    const deactivatedCompany = await request(`/empresas-asociadas/${created.body.data.id}`, "admin", {
      method: "PATCH",
      body: { activa: false, confirmar_servicios_afectados: true, servicios_afectados_confirmados: 3 },
    });
    assert.equal(deactivatedCompany.status, 200);
    assert.equal(state.companies[0].activa, false);
    assert.equal(state.vehicles[0].activo, true);

    state.vehicleServices = 1;
    const vehicleWarning = await request(`/empresas-asociadas/vehiculos/${vehicle.body.data.id}`, "admin", {
      method: "PATCH",
      body: { activo: false },
    });
    assert.equal(vehicleWarning.status, 409);
    assert.equal(vehicleWarning.body.servicios_afectados, 1);
    assert.equal(state.vehicles[0].activo, true);
    const deactivatedVehicle = await request(`/empresas-asociadas/vehiculos/${vehicle.body.data.id}`, "admin", {
      method: "PATCH",
      body: { activo: false, confirmar_servicios_afectados: true, servicios_afectados_confirmados: 1 },
    });
    assert.equal(deactivatedVehicle.status, 200);
    assert.equal(state.vehicles[0].activo, false);
  });

  await t.test("solicita y completa devoluciones manuales; una devolución total exige reserva cancelada", async () => {
    const payload = {
      monto: 20,
      motivo: "Servicio cancelado por emergencia",
    };
    assert.equal((await request("/pagos/601/reembolso", "operativo", { method: "POST", body: payload })).status, 403);

    const partial = await request("/pagos/601/reembolso", "admin", { method: "POST", body: payload });
    assert.equal(partial.status, 201, JSON.stringify(partial.body));
    assert.equal(partial.body.reembolso.estado, "pendiente");
    assert.equal(state.reservation.monto_pagado, 80);
    assert.equal(state.reservation.estado, "confirmada");
    assert.equal(state.refunds.length, 1);

    const totalPayload = { ...payload, monto: 60 };
    const notCancelled = await request("/pagos/601/reembolso", "admin", { method: "POST", body: totalPayload });
    assert.equal(notCancelled.status, 409);
    assert.match(notCancelled.body.error, /primero debe cancelarse/i);
    assert.equal(state.refunds.length, 1);

    state.reservation.estado = "cancelada";
    const registered = await request("/pagos/601/reembolso", "admin", { method: "POST", body: totalPayload });
    assert.equal(registered.status, 201, JSON.stringify(registered.body));
    assert.equal(registered.body.reembolso.estado, "pendiente");
    assert.equal(state.refunds.length, 2);

    const completedPartial = await request(`/reembolsos/${state.refunds[0].id}/completar`, "admin", {
      method: "PATCH",
      body: { referencia_externa: "DEV-TEST-PARTIAL" },
    });
    assert.equal(completedPartial.status, 200);
    assert.equal(state.reservation.monto_pagado, 60);
    assert.equal(state.reservation.estado_pago, "parcial");

    const completedTotal = await request(`/reembolsos/${state.refunds[1].id}/completar`, "admin", {
      method: "PATCH",
      body: { referencia_externa: "DEV-TEST-TOTAL" },
    });
    assert.equal(completedTotal.status, 200);
    assert.equal(state.reservation.monto_pagado, 0);
    assert.equal(state.reservation.estado_pago, "reembolsado");

    const alreadyCompleted = await request(`/reembolsos/${state.refunds[1].id}/completar`, "admin", {
      method: "PATCH",
      body: { referencia_externa: "DEV-TEST-SECOND" },
    });
    assert.equal(alreadyCompleted.status, 409);

    const overRefund = await request("/pagos/601/reembolso", "admin", {
      method: "POST",
      body: { ...payload, monto: 0.01 },
    });
    assert.equal(overRefund.status, 409);
    assert.equal(state.refunds.length, 2);
  });
});
