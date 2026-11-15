const test = require("node:test");
const assert = require("node:assert/strict");
const ExcelJS = require("exceljs");

process.env.DB_USER = process.env.DB_USER || "postgres";
process.env.DB_HOST = process.env.DB_HOST || "localhost";
process.env.DB_NAME = process.env.DB_NAME || "turesma_db";
process.env.DB_PASSWORD = process.env.DB_PASSWORD || "test";
process.env.DB_PORT = process.env.DB_PORT || "5432";

const pool = require("../dist/config/db");
const { createExcelReport, exportarReporteCSV } = require("../dist/controllers/admin/historial-reportes.admin.controller");

test("exporta un libro XLSX de reservas que ExcelJS puede volver a abrir", async () => {
  let responseBuffer;
  const response = {
    setHeader() {},
    status(code) {
      assert.equal(code, 200);
      return this;
    },
    end(buffer) {
      responseBuffer = buffer;
      return this;
    },
  };

  await createExcelReport(response, {
    rows: [{
      id: 12,
      fecha_reserva: "2026-10-18",
      estado: "confirmada",
      num_personas: 8,
      total: 240,
      cliente: "Cliente de prueba",
      servicio: "Traslado",
      conductor: "Conductor",
      vehiculo: "ABC-1234",
    }],
    headers: ["id", "fecha_reserva", "estado", "num_personas", "total", "cliente", "servicio", "conductor", "vehiculo"],
    headerLabels: { id: "N.º de reserva", total: "Total (USD)" },
    filename: "reporte_reservas",
    title: "Reporte de reservas",
  });

  assert.ok(Buffer.isBuffer(responseBuffer));
  assert.equal(responseBuffer.subarray(0, 4).toString("hex"), "504b0304");

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(responseBuffer);
  const worksheet = workbook.getWorksheet("Reporte");
  assert.ok(worksheet);
  assert.equal(worksheet.getCell("A8").value, "N.º de reserva");
  assert.equal(worksheet.getCell("A9").value, 12);
  assert.equal(worksheet.getCell("F9").value, "Cliente de prueba");
});

test("exporta solo las reservas por atender cuando se filtra esa vista", async () => {
  const originalQuery = pool.query;
  let capturedQuery = "";
  let responseBody = "";
  pool.query = async (query) => {
    capturedQuery = query;
    return { rows: [] };
  };
  const response = {
    setHeader() {},
    status(code) {
      assert.equal(code, 200);
      return this;
    },
    send(body) {
      responseBody = body;
      return this;
    },
  };

  try {
    await exportarReporteCSV({
      query: { tipo: "reservas", grupo_estado: "por_atender" },
    }, response);
  } finally {
    pool.query = originalQuery;
  }

  assert.match(capturedQuery, /COALESCE\(r\.estado, ''\) NOT IN \('en_curso', 'finalizada', 'cancelada'\)/);
  assert.match(responseBody, /N.º de reserva/);
});
