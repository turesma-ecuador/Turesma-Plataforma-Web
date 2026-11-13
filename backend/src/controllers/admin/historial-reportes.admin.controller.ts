export {};

const pool = require("../../config/db");
const ExcelJS = require("exceljs");
const fs = require("fs");
const path = require("path");

const LOGO_PATHS = [
  path.join(process.cwd(), "..", "web", "public", "logo.png"),
  path.join(__dirname, "..", "..", "..", "..", "web", "public", "logo.png"),
];

const createExcelReport = async (res, { rows, headers, headerLabels, filename, title }) => {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Turesma S.A.";
  workbook.created = new Date();
  workbook.subject = title;

  const worksheet = workbook.addWorksheet("Reporte", {
    pageSetup: { paperSize: 9, orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    views: [{ state: "frozen", ySplit: 8 }],
  });
  const columnCount = headers.length;
  const lastColumn = worksheet.getColumn(columnCount).letter;
  worksheet.columns = headers.map((header) => ({
    key: header,
    width: Math.max(16, Math.min(32, (headerLabels[header] ?? header).length + 4)),
  }));

  worksheet.mergeCells(`A1:${lastColumn}3`);
  worksheet.mergeCells(`A4:${lastColumn}4`);
  worksheet.mergeCells(`A5:${lastColumn}5`);
  worksheet.mergeCells(`A6:${lastColumn}6`);
  worksheet.getRow(1).height = 26;
  worksheet.getRow(2).height = 26;
  worksheet.getRow(3).height = 18;
  worksheet.getRow(4).height = 30;
  worksheet.getRow(5).height = 20;
  worksheet.getRow(6).height = 20;
  worksheet.getRow(7).height = 8;

  const titleCell = worksheet.getCell("A4");
  titleCell.value = title;
  titleCell.font = { name: "Arial", size: 18, bold: true, color: { argb: "FFFFFFFF" } };
  titleCell.alignment = { vertical: "middle", horizontal: "center" };
  titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0B0F1A" } };

  const generatedCell = worksheet.getCell("A5");
  generatedCell.value = "REPORTE TURESMA S.A.";
  generatedCell.font = { name: "Arial", size: 10, bold: true, color: { argb: "FFFFD400" } };
  generatedCell.alignment = { vertical: "middle", horizontal: "center" };
  generatedCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0B0F1A" } };

  worksheet.getCell("A6").value =
    `Generado: ${new Date().toLocaleString("es-EC")}  |  Registros: ${rows.length}`;
  worksheet.getCell("A6").font = { name: "Arial", size: 10, color: { argb: "FF475569" } };
  worksheet.getCell("A6").alignment = { vertical: "middle", horizontal: "center" };

  const logoPath = LOGO_PATHS.find((candidate) => fs.existsSync(candidate));
  if (logoPath) {
    const imageId = workbook.addImage({ buffer: fs.readFileSync(logoPath), extension: "png" });
    const logoStartColumn = Math.max(0, (columnCount - 2) / 2);
    worksheet.addImage(imageId, {
      tl: { col: logoStartColumn, row: 0.15 },
      br: { col: logoStartColumn + 2, row: 2.85 },
      editAs: "oneCell",
    });
  } else {
    const brandCell = worksheet.getCell("A1");
    brandCell.value = "TURESMA S.A.";
    brandCell.font = { name: "Arial", size: 16, bold: true, color: { argb: "FFE31E24" } };
    brandCell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  }

  const headerRow = worksheet.getRow(8);
  headers.forEach((header, index) => {
    const cell = headerRow.getCell(index + 1);
    cell.value = headerLabels[header] ?? header;
    cell.font = { name: "Arial", size: 10, bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0B0F1A" } };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    cell.border = { bottom: { style: "medium", color: { argb: "FFE31E24" } } };
  });
  headerRow.height = 30;

  rows.forEach((row, rowIndex) => {
    const excelRow = worksheet.getRow(rowIndex + 9);
    headers.forEach((header, columnIndex) => {
      const value = row[header];
      const cell = excelRow.getCell(columnIndex + 1);
      cell.value = value instanceof Date ? value.toISOString().slice(0, 10) : value ?? "";
      cell.font = { name: "Arial", size: 10, color: { argb: "FF1E293B" } };
      cell.alignment = { vertical: "middle", horizontal: "left", wrapText: true };
      cell.border = { bottom: { style: "hair", color: { argb: "FFE2E8F0" } } };
      if (rowIndex % 2 === 1) {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF8FAFC" } };
      }
      if (/total|rating_promedio/i.test(header) && typeof value === "number") {
        cell.numFmt = header.toLowerCase().includes("total") ? '$#,##0.00' : "0.00";
      }
    });
    excelRow.height = 22;
  });

  worksheet.autoFilter = {
    from: { row: 8, column: 1 },
    to: { row: 8, column: columnCount },
  };
  worksheet.pageSetup.printTitlesRow = "1:8";
  const buffer = await workbook.xlsx.writeBuffer();

  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}_${new Date().toISOString().slice(0, 10)}.xlsx"`);
  res.setHeader("Content-Length", buffer.byteLength);
  res.setHeader("Cache-Control", "no-store");
  res.status(200);
  return res.end(Buffer.from(buffer));
};

const historialViajes = async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT
         r.id,
         r.fecha_reserva,
         r.estado,
         r.num_personas,
         r.total,
         u.nombre AS usuario_nombre,
         c.nombre AS conductor_nombre,
         t.titulo AS tour_titulo,
         v.placa AS vehiculo_placa
       FROM reservas r
       INNER JOIN usuarios u ON u.id = r.usuario_id
       INNER JOIN tours t ON t.id = r.tour_id
       LEFT JOIN usuarios c ON c.id = r.conductor_id
       LEFT JOIN vehiculos v ON v.id = r.vehiculo_id
       ORDER BY r.fecha_reserva DESC, r.id DESC`
    );

    return res.status(200).json(result.rows);
  } catch (error) {
    console.error("Error obteniendo historial de viajes:", error);
    return res.status(500).json({ error: "Error interno del servidor" });
  }
};

const historialReservas = async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT
         r.id,
         r.fecha_creacion,
         r.fecha_reserva,
         r.estado,
         r.num_personas,
         r.total,
         u.nombre AS usuario_nombre,
         t.titulo AS tour_titulo
       FROM reservas r
       INNER JOIN usuarios u ON u.id = r.usuario_id
       INNER JOIN tours t ON t.id = r.tour_id
       ORDER BY r.fecha_creacion DESC, r.id DESC`
    );

    return res.status(200).json(result.rows);
  } catch (error) {
    console.error("Error obteniendo historial de reservas:", error);
    return res.status(500).json({ error: "Error interno del servidor" });
  }
};

const viajesFinalizados = async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT
         r.id,
         r.fecha_reserva,
         r.num_personas,
         r.total,
         u.nombre AS usuario_nombre,
         c.nombre AS conductor_nombre,
         t.titulo AS tour_titulo,
         v.placa AS vehiculo_placa
       FROM reservas r
       INNER JOIN usuarios u ON u.id = r.usuario_id
       INNER JOIN tours t ON t.id = r.tour_id
       LEFT JOIN usuarios c ON c.id = r.conductor_id
       LEFT JOIN vehiculos v ON v.id = r.vehiculo_id
       WHERE r.estado = 'finalizada'
       ORDER BY r.fecha_reserva DESC, r.id DESC`
    );

    return res.status(200).json(result.rows);
  } catch (error) {
    console.error("Error obteniendo viajes finalizados:", error);
    return res.status(500).json({ error: "Error interno del servidor" });
  }
};

const reporteViajes = async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT
         fecha_reserva,
         COUNT(*) AS cantidad_viajes,
         COUNT(*) FILTER (WHERE estado = 'finalizada') AS viajes_finalizados,
         COALESCE(SUM(monto_pagado), 0) AS ingresos
       FROM reservas
       GROUP BY fecha_reserva
       ORDER BY fecha_reserva DESC`
    );

    return res.status(200).json(result.rows);
  } catch (error) {
    console.error("Error obteniendo reporte de viajes:", error);
    return res.status(500).json({ error: "Error interno del servidor" });
  }
};

const reporteReservas = async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT
         estado,
         COUNT(*) AS cantidad,
         COALESCE(SUM(total), 0) AS total,
         COALESCE(SUM(monto_pagado), 0) AS ingresos_netos
       FROM reservas
       GROUP BY estado
       ORDER BY estado ASC`
    );

    return res.status(200).json(result.rows);
  } catch (error) {
    console.error("Error obteniendo reporte de reservas:", error);
    return res.status(500).json({ error: "Error interno del servidor" });
  }
};

const reporteVehiculosUsados = async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT
         v.id,
         v.placa,
         v.modelo,
         COUNT(r.id) AS viajes_realizados,
         COALESCE(SUM(r.num_personas), 0) AS personas_transportadas
       FROM vehiculos v
       LEFT JOIN reservas r
         ON r.vehiculo_id = v.id
         AND r.estado <> 'cancelada'
       GROUP BY v.id, v.placa, v.modelo
       ORDER BY viajes_realizados DESC, v.placa ASC`
    );

    return res.status(200).json(result.rows);
  } catch (error) {
    console.error("Error obteniendo reporte de vehículos usados:", error);
    return res.status(500).json({ error: "Error interno del servidor" });
  }
};

const verHistorial = historialReservas;

const verReportes = async (_req, res) => {
  try {
    const [resumen, porEstado, porTour] = await Promise.all([
      pool.query(
        `SELECT
           COUNT(*) AS total_reservas,
          COALESCE(SUM(total), 0) AS total_facturado,
          COALESCE(SUM(monto_pagado), 0) AS ingresos_totales,
          (SELECT COALESCE(SUM(monto), 0) FROM reembolsos_reserva WHERE estado = 'completado') AS total_devuelto,
           COUNT(*) FILTER (WHERE estado = 'pendiente') AS pendientes,
           COUNT(*) FILTER (WHERE estado = 'confirmada') AS confirmadas,
           COUNT(*) FILTER (WHERE estado = 'cancelada') AS canceladas
         FROM reservas`
      ),
      pool.query(
        `SELECT estado, COUNT(*) AS cantidad
         FROM reservas
         GROUP BY estado
         ORDER BY estado ASC`
      ),
      pool.query(
        `SELECT t.titulo, COUNT(r.id) AS cantidad_reservas,
                COALESCE(SUM(r.total), 0) AS total,
                COALESCE(SUM(r.monto_pagado), 0) AS ingresos_netos
         FROM tours t
         LEFT JOIN reservas r ON r.tour_id = t.id
         GROUP BY t.id, t.titulo
         ORDER BY cantidad_reservas DESC, t.titulo ASC`
      ),
    ]);

    return res.status(200).json({
      resumen: resumen.rows[0],
      por_estado: porEstado.rows,
      por_tour: porTour.rows,
    });
  } catch (error) {
    console.error("Error obteniendo reportes:", error);
    return res.status(500).json({ error: "Error interno del servidor" });
  }
};

const exportarReporteCSV = async (req, res) => {
  const tipo = String(req.query.tipo || "reservas");

  try {
    let rows: any[] = [];
    let headers: string[] = [];
    let headerLabels: Record<string, string> = {};
    let filename = "reporte";

    if (tipo === "vehiculos") {
      const result = await pool.query(
        `SELECT v.placa, v.modelo, v.tipo, v.capacidad, v.color, v.estado,
                u.nombre AS conductor, COUNT(r.id) AS viajes_realizados
         FROM vehiculos v
         LEFT JOIN usuarios u ON u.id = v.usuario_id
         LEFT JOIN reservas r ON r.vehiculo_id = v.id AND r.estado <> 'cancelada'
         WHERE v.activo = true
         GROUP BY v.id, v.placa, v.modelo, v.tipo, v.capacidad, v.color, v.estado, u.nombre
         ORDER BY v.placa ASC`
      );
      rows = result.rows;
      headers = ["placa", "modelo", "tipo", "capacidad", "color", "estado", "conductor", "viajes_realizados"];
      headerLabels = {
        placa: "Placa",
        modelo: "Modelo",
        tipo: "Tipo de vehículo",
        capacidad: "Capacidad (pasajeros)",
        color: "Color",
        estado: "Estado",
        conductor: "Conductor asignado",
        viajes_realizados: "Viajes realizados",
      };
      filename = "reporte_vehiculos";
    } else if (tipo === "conductores") {
      const result = await pool.query(
        `SELECT u.nombre, u.email, u.telefono, c.licencia, c.estado, c.rating_promedio,
                c.viajes_completados, c.horas_conduccion, c.estado_documentos
         FROM usuarios u
         LEFT JOIN conductores c ON c.usuario_id = u.id
         WHERE LOWER(u.rol) = 'vehiculo' AND u.activo = true
         ORDER BY u.nombre ASC`
      );
      rows = result.rows;
      headers = ["nombre", "email", "telefono", "licencia", "estado", "rating_promedio", "viajes_completados", "horas_conduccion", "estado_documentos"];
      headerLabels = {
        nombre: "Nombre",
        email: "Correo electrónico",
        telefono: "Teléfono",
        licencia: "Tipo de licencia",
        estado: "Estado",
        rating_promedio: "Calificación promedio",
        viajes_completados: "Viajes completados",
        horas_conduccion: "Horas de conducción",
        estado_documentos: "Estado de documentos",
      };
      filename = "reporte_conductores";
    } else if (tipo === "clientes") {
      const result = await pool.query(
        `SELECT u.nombre, u.email, u.telefono, u.cedula, u.estado_verificacion,
                u.activo, COUNT(r.id)::int AS total_reservas,
                COALESCE(SUM(CASE WHEN r.estado <> 'cancelada' THEN r.total ELSE 0 END), 0) AS total_facturado
         FROM usuarios u
         LEFT JOIN reservas r ON r.usuario_id = u.id
         WHERE LOWER(u.rol) = 'cliente'
         GROUP BY u.id, u.nombre, u.email, u.telefono, u.cedula, u.estado_verificacion, u.activo
         ORDER BY u.nombre ASC`
      );
      rows = result.rows;
      headers = ["nombre", "email", "telefono", "cedula", "estado_verificacion", "activo", "total_reservas", "total_facturado"];
      headerLabels = {
        nombre: "Nombre",
        email: "Correo electrónico",
        telefono: "Teléfono",
        cedula: "Cédula",
        estado_verificacion: "Verificación",
        activo: "Estado",
        total_reservas: "Total de reservas",
        total_facturado: "Total facturado (USD)",
      };
      filename = "reporte_clientes";
    } else {
      // reservas (default) — admite filtrar por rango de fecha (?desde=&hasta=),
      // el mismo filtro que ya usa el Dashboard de Rendimiento.
      const { desde, hasta } = req.query;
      const params: any[] = [];
      const filtros: string[] = [];
      if (desde && hasta) {
        params.push(desde, hasta);
        filtros.push(`r.fecha_reserva BETWEEN $1 AND $2`);
      }
      const estado = String(req.query.estado || "").trim();
      if (estado && estado !== "todos") {
        params.push(estado);
        filtros.push(`r.estado = $${params.length}`);
      }
      const busqueda = String(req.query.busqueda || "").trim().slice(0, 100);
      if (busqueda) {
        params.push(busqueda);
        const searchParam = `$${params.length}`;
        filtros.push(`(
          POSITION(LOWER(${searchParam}) IN LOWER(r.id::text)) > 0
          OR POSITION(LOWER(${searchParam}) IN LOWER(COALESCE(u.nombre, ''))) > 0
          OR POSITION(LOWER(${searchParam}) IN LOWER(COALESCE(v.placa, ''))) > 0
          OR POSITION(LOWER(${searchParam}) IN LOWER(COALESCE(to_jsonb(r)->>'destino', ''))) > 0
          OR POSITION(LOWER(${searchParam}) IN LOWER(COALESCE(to_jsonb(r)->>'origen', ''))) > 0
        )`);
      }
      const whereClause = filtros.length ? `WHERE ${filtros.join(" AND ")}` : "";

      const result = await pool.query(
        `SELECT r.id, r.fecha_reserva, r.estado, r.num_personas, r.total,
               COALESCE(r.monto_pagado, 0) AS ingresos_netos,
                u.nombre AS cliente, t.titulo AS servicio,
                uc.nombre AS conductor, v.placa AS vehiculo
         FROM reservas r
         LEFT JOIN usuarios u ON u.id = r.usuario_id
         LEFT JOIN tours t ON t.id = r.tour_id
         LEFT JOIN conductores c ON c.id = r.conductor_id
         LEFT JOIN usuarios uc ON uc.id = c.usuario_id
         LEFT JOIN vehiculos v ON v.id = r.vehiculo_id
         ${whereClause}
         ORDER BY r.fecha_reserva DESC, r.id DESC
         LIMIT 1000`,
        params
      );
      rows = result.rows;
      headers = ["id", "fecha_reserva", "estado", "num_personas", "total", "ingresos_netos", "cliente", "servicio", "conductor", "vehiculo"];
      headerLabels = {
        id: "N.º de reserva",
        fecha_reserva: "Fecha de reserva",
        estado: "Estado",
        num_personas: "Número de pasajeros",
        total: "Total (USD)",
        ingresos_netos: "Cobrado neto (USD)",
        cliente: "Cliente",
        servicio: "Servicio",
        conductor: "Conductor",
        vehiculo: "Vehículo",
      };
      filename = "reporte_reservas";
    }

    if (String(req.query.formato || "").toLowerCase() === "xlsx") {
      const titles = {
        vehiculos: "Reporte de flota vehicular",
        conductores: "Reporte de conductores",
        clientes: "Reporte de clientes",
        reservas: "Reporte de reservas",
      };
      const title = titles[tipo] || titles.reservas;
      return await createExcelReport(res, { rows, headers, headerLabels, filename, title });
    }

    const escapeCsvCell = (value: unknown) => {
      const raw = value instanceof Date ? value.toISOString().slice(0, 10) : String(value ?? "");
      const isNumeric = /^-?\d+(?:\.\d+)?$/.test(raw.trim());
      const safe = !isNumeric && /^[\t\r\n ]*[=+\-@]/.test(raw) ? `'${raw}` : raw;
      const escaped = safe.replace(/"/g, '""');
      return /[",\r\n]/.test(escaped) ? `"${escaped}"` : escaped;
    };

    const csvLines = [
      headers.map((header) => escapeCsvCell(headerLabels[header] ?? header)).join(","),
      ...rows.map((row) =>
        headers.map((header) => escapeCsvCell(row[header])).join(",")
      ),
    ];

    const csv = csvLines.join("\n");

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}_${new Date().toISOString().slice(0, 10)}.csv"`);
    return res.status(200).send("\uFEFF" + csv); // BOM para Excel
  } catch (error) {
    console.error("Error exportando CSV:", error);
    return res.status(500).json({ error: "Error interno del servidor" });
  }
};

module.exports = {
  historialViajes,
  historialReservas,
  viajesFinalizados,
  reporteViajes,
  reporteReservas,
  reporteVehiculosUsados,
  verHistorial,
  verReportes,
  exportarReporteCSV,
  createExcelReport,
};
