export {};

const pool = require("../../config/db");
const { isReservaEstadoValido } = require("../../config/catalogoHelpers");
const { syncReservaEstadosAutomaticos } = require("../../config/reservaEstadoAuto");
const { notificarClienteReserva } = require("../../config/reservaMailer");

const parsePositiveInt = (value) => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
};

const normalizeTimestampInput = (value) => {
  if (value === null || value === undefined || value === "") return null;

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return value.toISOString().slice(0, 19).replace("T", " ");
  }

  const raw = String(value).trim();
  if (!raw) return null;

  if (/^\d+$/.test(raw)) {
    const parsed = new Date(Number(raw));
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed.toISOString().slice(0, 19).replace("T", " ");
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return `${raw} 00:00:00`;
  }

  if (raw.includes("T")) {
    return raw.replace("T", " ").replace("Z", "").slice(0, 19);
  }

  return raw.slice(0, 19);
};

const getReservasColumnInfo = async (columnName) => {
  const result = await pool.query(
    `SELECT column_name, is_nullable
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'reservas'
       AND column_name = $1
     LIMIT 1`,
    [columnName]
  );

  if (result.rowCount === 0) {
    return { exists: false, required: false };
  }

  return {
    exists: true,
    required: result.rows[0].is_nullable === "NO",
  };
};

const getReservasHotelColumnInfo = async () => getReservasColumnInfo("hotel_id");

const hasTableColumn = async (tableName, columnName) => {
  const result = await pool.query(
    `SELECT 1
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = $1
       AND column_name = $2
     LIMIT 1`,
    [tableName, columnName]
  );

  return result.rowCount > 0;
};

const getReservasConductorForeignTarget = async () => {
  const result = await pool.query(
    `SELECT ccu.table_name AS referenced_table
     FROM information_schema.table_constraints tc
     INNER JOIN information_schema.key_column_usage kcu
       ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
     INNER JOIN information_schema.constraint_column_usage ccu
       ON ccu.constraint_name = tc.constraint_name
      AND ccu.table_schema = tc.table_schema
     WHERE tc.table_schema = 'public'
       AND tc.table_name = 'reservas'
       AND tc.constraint_type = 'FOREIGN KEY'
       AND kcu.column_name = 'conductor_id'
     LIMIT 1`
  );

  return String(result.rows[0]?.referenced_table || "usuarios").toLowerCase();
};

const getReservaSelectColumn = async (columnName, alias = columnName) => {
  const info = await getReservasColumnInfo(columnName);
  return info.exists ? `r.${columnName} AS ${alias}` : `NULL AS ${alias}`;
};

const getFallbackHotelId = async () => {
  const tableResult = await pool.query("SELECT to_regclass('public.hoteles') AS hoteles_table");
  if (!tableResult.rows[0]?.hoteles_table) return null;

  const hotelResult = await pool.query("SELECT id FROM hoteles ORDER BY id ASC LIMIT 1");
  if (hotelResult.rowCount === 0) return null;

  return parsePositiveInt(hotelResult.rows[0].id);
};

const getTourInfo = async (tourId) => {
  const result = await pool.query(
    "SELECT id, precio, capacidad FROM tours WHERE id = $1 AND activo = true LIMIT 1",
    [tourId]
  );
  return result.rowCount ? result.rows[0] : null;
};

const validateTourCapacity = async ({ tourId, fechaReserva, numPersonas, excludeReservaId }) => {
  const values = [tourId, fechaReserva];
  let filterExclude = "";

  if (excludeReservaId) {
    values.push(excludeReservaId);
    filterExclude = `AND id <> $${values.length}`;
  }

  const occupancyResult = await pool.query(
    `SELECT COALESCE(SUM(num_personas), 0) AS personas_reservadas
     FROM reservas
     WHERE tour_id = $1
       AND fecha_reserva = $2
       AND estado NOT IN ('cancelada', 'finalizada')
       ${filterExclude}`,
    values
  );

  return Number(occupancyResult.rows[0].personas_reservadas || 0) + numPersonas;
};

const validateVehiculoDisponible = async ({ vehiculoId, fechaReserva, reservaId }) => {
  if (!vehiculoId) return;

  const vehiculoResult = await pool.query(
    `SELECT id, estado, COALESCE(dias_servicio, ARRAY[0,1,2,3,4,5,6]) AS dias_servicio
     FROM vehiculos
     WHERE id = $1
       AND activo = true
     LIMIT 1`,
    [vehiculoId]
  );

  if (vehiculoResult.rowCount === 0) {
    throw new Error("Vehículo no encontrado");
  }

  if (vehiculoResult.rows[0].estado !== "disponible") {
    throw new Error("El vehículo no está disponible");
  }

  const disponibilidadManualResult = await pool.query(
    `SELECT disponible
     FROM vehiculo_disponibilidad
     WHERE vehiculo_id = $1
       AND fecha = $2::date
     LIMIT 1`,
    [vehiculoId, fechaReserva]
  );

  const diasServicio = Array.isArray(vehiculoResult.rows[0].dias_servicio)
    ? vehiculoResult.rows[0].dias_servicio.map((value) => Number(value)).filter((value) => Number.isInteger(value))
    : [0, 1, 2, 3, 4, 5, 6];

  const fechaDowResult = await pool.query("SELECT EXTRACT(DOW FROM $1::date)::INT AS dow", [fechaReserva]);
  const dow = Number(fechaDowResult.rows[0]?.dow);

  const disponiblePorDia = diasServicio.includes(dow);
  const disponibleManual = disponibilidadManualResult.rowCount
    ? Boolean(disponibilidadManualResult.rows[0].disponible)
    : null;

  if ((disponibleManual === false) || (disponibleManual === null && !disponiblePorDia)) {
    throw new Error("El vehículo no ofrece servicio en esa fecha");
  }

  const values = [vehiculoId, fechaReserva];
  let excludeQuery = "";

  if (reservaId) {
    values.push(reservaId);
    excludeQuery = `AND id <> $${values.length}`;
  }

  const assignedResult = await pool.query(
    `SELECT id
     FROM reservas
     WHERE vehiculo_id = $1
       AND fecha_reserva = $2
       AND estado NOT IN ('cancelada', 'finalizada')
       ${excludeQuery}
     LIMIT 1`,
    values
  );

  if (assignedResult.rowCount > 0) {
    throw new Error("Vehículo ya asignado en esa fecha");
  }
};

const validateConductorDisponible = async ({ conductorId, fechaReserva, reservaId }) => {
  if (!conductorId) return;

  const targetTable = await getReservasConductorForeignTarget();

  if (targetTable === "conductores") {
    const conductorResult = await pool.query(
      `SELECT id
       FROM conductores
       WHERE id = $1
       LIMIT 1`,
      [conductorId]
    );

    if (conductorResult.rowCount === 0) {
      throw new Error("Conductor no encontrado");
    }

    const values = [conductorId, fechaReserva];
    let excludeQuery = "";

    if (reservaId) {
      values.push(reservaId);
      excludeQuery = `AND id <> $${values.length}`;
    }

    const assignedResult = await pool.query(
      `SELECT id
       FROM reservas
       WHERE conductor_id = $1
         AND fecha_reserva = $2
         AND estado NOT IN ('cancelada', 'finalizada')
         ${excludeQuery}
       LIMIT 1`,
      values
    );

    if (assignedResult.rowCount > 0) {
      throw new Error("Conductor ya asignado en esa fecha");
    }

    return;
  }

  const conductorResult = await pool.query(
    `SELECT id
     FROM usuarios
     WHERE id = $1
       AND LOWER(rol) IN ('conductor', 'vehiculo')
       AND activo = true
     LIMIT 1`,
    [conductorId]
  );

  if (conductorResult.rowCount === 0) {
    throw new Error("Vehiculo no encontrado");
  }

  const values = [conductorId, fechaReserva];
  let excludeQuery = "";

  if (reservaId) {
    values.push(reservaId);
    excludeQuery = `AND id <> $${values.length}`;
  }

  const assignedResult = await pool.query(
    `SELECT id
     FROM reservas
     WHERE conductor_id = $1
       AND fecha_reserva = $2
       AND estado NOT IN ('cancelada', 'finalizada')
       ${excludeQuery}
     LIMIT 1`,
    values
  );

  if (assignedResult.rowCount > 0) {
    throw new Error("Conductor ya asignado en esa fecha");
  }
};

const getCatalogo = async (_req, res) => {
  try {
    const [usuarios, tours, vehiculos, conductores] = await Promise.all([
      pool.query("SELECT id, nombre, email, rol, activo, hotel_id FROM usuarios ORDER BY nombre ASC"),
      pool.query("SELECT id, titulo, precio, capacidad FROM tours WHERE activo = true ORDER BY id ASC"),
      pool.query(
        `SELECT
           v.id,
           v.placa,
           v.usuario_id,
           v.tipo,
           v.modelo,
           v.capacidad,
           v.color,
           v.imagen_url,
           v.descripcion,
           COALESCE(v.dias_servicio, ARRAY[0,1,2,3,4,5,6]) AS dias_servicio,
           v.estado,
           v.activo,
           u.nombre AS conductor_nombre,
           u.email AS conductor_email
         FROM vehiculos v
         LEFT JOIN usuarios u ON u.id = v.usuario_id
         ORDER BY v.id ASC`
      ),
      pool.query(
        "SELECT id, nombre, email, activo FROM usuarios WHERE LOWER(rol) IN ('conductor', 'vehiculo') ORDER BY nombre ASC"
      ),
    ]);

    return res.status(200).json({
      usuarios: usuarios.rows,
      tours: tours.rows,
      vehiculos: vehiculos.rows,
      conductores: conductores.rows,
    });
  } catch (error) {
    console.error("Error obteniendo catálogo admin:", error);
    return res.status(500).json({ error: "Error interno del servidor" });
  }
};

const listarReservas = async (req, res) => {
  try {
    await syncReservaEstadosAutomaticos();

    const [origenSelect, destinoSelect, fechaSalidaSelect, fechaLlegadaSelect, fechaServicioSelect] = await Promise.all([
      getReservaSelectColumn("origen"),
      getReservaSelectColumn("destino"),
      getReservaSelectColumn("fecha_salida"),
      getReservaSelectColumn("fecha_llegada"),
      getReservaSelectColumn("fecha_servicio"),
    ]);

    // Filtro opcional por cliente (?usuario_id=)
    const usuarioId = parsePositiveInt(req.query?.usuario_id);
    const whereClause = usuarioId ? `WHERE r.usuario_id = $1` : "";
    const params = usuarioId ? [usuarioId] : [];

    const result = await pool.query(
      `SELECT
         r.id,
         r.usuario_id,
         r.tour_id,
         r.vehiculo_id,
         r.conductor_id,
         r.fecha_reserva,
         r.num_personas,
         r.total,
         CASE
           WHEN r.estado = 'confirmada' AND r.estado_operativo = 'en_curso' THEN 'en_curso'
           ELSE r.estado
         END AS estado,
         r.estado_operativo,
         r.monto_pagado,
         r.estado_pago,
         r.link_pago,
         r.fecha_creacion,
         r.tipo_vehiculo,
         r.notas,
         ${origenSelect},
         ${destinoSelect},
         ${fechaSalidaSelect},
         ${fechaLlegadaSelect},
         ${fechaServicioSelect},
         u.nombre AS cliente_nombre,
         u.email AS cliente_email,
         t.titulo AS tour_titulo,
         v.placa AS vehiculo_placa,
         v.modelo AS vehiculo_modelo,
         uc.nombre AS conductor_nombre
       FROM reservas r
       INNER JOIN usuarios u ON u.id = r.usuario_id
      LEFT JOIN tours t ON t.id = r.tour_id
       LEFT JOIN vehiculos v ON v.id = r.vehiculo_id
       LEFT JOIN conductores c ON c.id = r.conductor_id
       LEFT JOIN usuarios uc ON uc.id = c.usuario_id
       ${whereClause}
       ORDER BY r.id DESC`,
      params
    );

    return res.status(200).json(result.rows);
  } catch (error) {
    console.error("Error listando reservas:", error);
    return res.status(500).json({ error: "Error interno del servidor" });
  }
};

const crearReserva = async (req, res) => {
  const { usuario_id, tour_id, fecha_reserva, num_personas, estado } = req.body;

  const usuarioId = parsePositiveInt(usuario_id);
  const tourId = parsePositiveInt(tour_id);
  const numPersonas = parsePositiveInt(num_personas);

  if (!usuarioId || !fecha_reserva || !numPersonas) {
    return res.status(400).json({
      error: "Debes enviar usuario_id, fecha_reserva y num_personas válidos",
    });
  }

  const estadoFinal = estado || "pendiente_pago";

  if (!["pendiente", "pendiente_pago"].includes(estadoFinal)) {
    return res.status(400).json({
      error: "Una reserva nueva debe quedar pendiente hasta registrar el pago y confirmar el servicio",
    });
  }

  if (!(await isReservaEstadoValido(estadoFinal))) {
    return res.status(400).json({ error: "Estado de viaje inválido" });
  }

  const submittedTotal = req.body.total;
  const parsedTotal = submittedTotal === null || submittedTotal === undefined || submittedTotal === ""
    ? null
    : Number(submittedTotal);
  if (parsedTotal !== null && (!Number.isFinite(parsedTotal) || parsedTotal < 0)) {
    return res.status(400).json({ error: "El total debe ser un monto válido mayor o igual a cero" });
  }

  try {
    const userResult = await pool.query("SELECT id, hotel_id FROM usuarios WHERE id = $1 LIMIT 1", [usuarioId]);

    if (userResult.rowCount === 0) {
      return res.status(404).json({ error: "Usuario no encontrado" });
    }

    let tour = null;

    if (tourId) {
      tour = await getTourInfo(tourId);

      if (!tour) {
        return res.status(404).json({ error: "Tour no encontrado" });
      }

      const ocupacion = await validateTourCapacity({
        tourId,
        fechaReserva: fecha_reserva,
        numPersonas,
        excludeReservaId: null,
      });

      if (ocupacion > Number(tour.capacidad || 0)) {
        return res.status(400).json({
          error: "No hay capacidad suficiente para ese tour en la fecha indicada",
        });
      }
    }

    const total = parsedTotal ?? (tour ? Number(tour.precio) * numPersonas : 0);

    const reservasHotelColumn = await getReservasHotelColumnInfo();
    const requestedHotelId = parsePositiveInt(req.body.hotel_id);
    const userHotelId = parsePositiveInt(userResult.rows[0]?.hotel_id);

    let hotelIdFinal = requestedHotelId || userHotelId || null;

    if (reservasHotelColumn.required && !hotelIdFinal) {
      hotelIdFinal = await getFallbackHotelId();
    }

    const parsedOrigenLat = Number(req.body.origen_lat);
    const parsedOrigenLng = Number(req.body.origen_lng);
    const parsedDestinoLat = Number(req.body.destino_lat);
    const parsedDestinoLng = Number(req.body.destino_lng);

    const origenLat = Number.isFinite(parsedOrigenLat) ? parsedOrigenLat : null;
    const origenLng = Number.isFinite(parsedOrigenLng) ? parsedOrigenLng : null;
    const destinoLat = Number.isFinite(parsedDestinoLat) ? parsedDestinoLat : null;
    const destinoLng = Number.isFinite(parsedDestinoLng) ? parsedDestinoLng : null;

    const origenTextoReq = typeof req.body.origen === "string" ? req.body.origen.trim() : "";
    const destinoTextoReq = typeof req.body.destino === "string" ? req.body.destino.trim() : "";

    const origenTexto = origenTextoReq || (origenLat !== null && origenLng !== null ? `${origenLat},${origenLng}` : "Origen pendiente");
    const destinoTexto = destinoTextoReq || (destinoLat !== null && destinoLng !== null ? `${destinoLat},${destinoLng}` : "Destino pendiente");

    const fechaReservaTimestamp = normalizeTimestampInput(fecha_reserva) || `${String(fecha_reserva).slice(0, 10)} 00:00:00`;
    const fechaSalida = normalizeTimestampInput(req.body.fecha_salida) || fechaReservaTimestamp;
    const fechaLlegada = normalizeTimestampInput(req.body.fecha_llegada) || fechaReservaTimestamp;
    const fechaServicio = normalizeTimestampInput(req.body.fecha_servicio) || fechaReservaTimestamp;

    let insertSql = `INSERT INTO reservas (
        usuario_id,
        tour_id,
        conductor_id,
        vehiculo_id,
        fecha_reserva,
        num_personas,
        total,
        estado`;

    const insertValues = [usuarioId, tourId || null, null, null, fecha_reserva, numPersonas, total, estadoFinal];

    const optionalColumns = [
      { name: "hotel_id", value: hotelIdFinal, requiredFallback: hotelIdFinal || await getFallbackHotelId() },
      { name: "origen", value: origenTexto, requiredFallback: "Origen pendiente" },
      { name: "destino", value: destinoTexto, requiredFallback: "Destino pendiente" },
      { name: "fecha_salida", value: fechaSalida, requiredFallback: fechaReservaTimestamp },
      { name: "fecha_llegada", value: fechaLlegada, requiredFallback: fechaReservaTimestamp },
      { name: "fecha_servicio", value: fechaServicio, requiredFallback: fechaReservaTimestamp },
      { name: "origen_lat", value: origenLat, requiredFallback: 0 },
      { name: "origen_lng", value: origenLng, requiredFallback: 0 },
      { name: "destino_lat", value: destinoLat, requiredFallback: 0 },
      { name: "destino_lng", value: destinoLng, requiredFallback: 0 },
      { name: "monto_pagado", value: 0, requiredFallback: 0 },
      { name: "estado_pago", value: "pendiente", requiredFallback: "pendiente" },
    ];

    for (const column of optionalColumns) {
      const info = await getReservasColumnInfo(column.name);
      if (!info.exists) continue;

      let value = column.value;
      if ((value === null || value === undefined || value === "") && info.required) {
        value = column.requiredFallback;
      }

      insertSql += `, ${column.name}`;
      insertValues.push(value ?? null);
    }

    insertSql += `)
      VALUES (${insertValues.map((_, index) => `$${index + 1}`).join(", ")})
      RETURNING *`;

    const insertResult = await pool.query(insertSql, insertValues);
    try {
      await pool.query(
        `INSERT INTO reserva_historial (reserva_id, usuario_id, accion, estado_nuevo, detalle)
         VALUES ($1, $2, 'creada_por_admin', $3, $4)`,
        [
          insertResult.rows[0].id,
          req.user?.id || null,
          estadoFinal,
          JSON.stringify({ creado_por_administrador: true, cliente_id: usuarioId }),
        ]
      );
    } catch (historyError) {
      console.error("No se pudo registrar la creación de la reserva en el historial:", historyError);
    }

    return res.status(201).json({
      message: "Reserva creada correctamente",
      reserva: insertResult.rows[0],
    });
  } catch (error) {
    if (error.code === "23502" && String(error.column || "") === "hotel_id") {
      return res.status(400).json({
        error: "No se pudo determinar el hotel de la reserva. Envía hotel_id válido o asigna hotel_id al usuario.",
      });
    }

    if (error.code === "23502" && String(error.column || "") === "origen") {
      return res.status(400).json({
        error: "No se pudo determinar el origen de la reserva. Intenta seleccionar el mapa nuevamente.",
      });
    }

    if (error.code === "23502" && String(error.column || "") === "fecha_servicio") {
      return res.status(400).json({
        error: "No se pudo determinar la fecha de servicio de la reserva.",
      });
    }

    if (error.code === "23503" && String(error.detail || "").toLowerCase().includes("hotel_id")) {
      return res.status(400).json({
        error: "El hotel_id enviado no existe. Usa un hotel válido para crear la reserva.",
      });
    }

    console.error("Error creando reserva:", error);
    return res.status(500).json({ error: error.message || "Error interno del servidor" });
  }
};

const editarReserva = async (req, res) => {
  const reservaId = parsePositiveInt(req.params.id);

  if (!reservaId) {
    return res.status(400).json({ error: "ID de reserva inválido" });
  }

  try {
    const currentResult = await pool.query("SELECT * FROM reservas WHERE id = $1 LIMIT 1", [reservaId]);

    if (currentResult.rowCount === 0) {
      return res.status(404).json({ error: "Reserva no encontrada" });
    }

    const current = currentResult.rows[0];
    if (Object.prototype.hasOwnProperty.call(req.body || {}, "estado")) {
      return res.status(400).json({ error: "El estado no se modifica al editar. Usa las acciones de estado o Despacho." });
    }

    const usuarioId = parsePositiveInt(req.body.usuario_id) || current.usuario_id;
    const tourId = parsePositiveInt(req.body.tour_id) || current.tour_id;
    const conductorId = current.conductor_id;
    const vehiculoId = current.vehiculo_id;
    const fechaReserva = req.body.fecha_reserva || current.fecha_reserva;
    const numPersonas = parsePositiveInt(req.body.num_personas) || current.num_personas;
    const estado = current.estado;
    const fechaReservaActual = String(current.fecha_reserva || "").slice(0, 10);
    const fechaReservaNueva = String(fechaReserva || "").slice(0, 10);
    const rutaCambiada = ["origen", "destino"].some((field) =>
      Object.prototype.hasOwnProperty.call(req.body || {}, field)
      && String(req.body[field] || "").trim() !== String(current[field] || "").trim()
    );
    const servicioCambiado = rutaCambiada
      || (Object.prototype.hasOwnProperty.call(req.body || {}, "num_personas")
        && Number(req.body.num_personas) !== Number(current.num_personas))
      || (Object.prototype.hasOwnProperty.call(req.body || {}, "tour_id")
        && Number(req.body.tour_id || 0) !== Number(current.tour_id || 0));
    const estadoFinal = estado;
    const fechaReservaTimestamp = normalizeTimestampInput(fechaReserva) || `${String(fechaReserva).slice(0, 10)} 00:00:00`;
    const fechaSalida = normalizeTimestampInput(req.body.fecha_salida) || normalizeTimestampInput(current.fecha_salida) || fechaReservaTimestamp;
    const fechaLlegada = normalizeTimestampInput(req.body.fecha_llegada) || normalizeTimestampInput(current.fecha_llegada) || fechaReservaTimestamp;
    const fechaServicio = normalizeTimestampInput(req.body.fecha_servicio) || fechaSalida;
    const scheduleChanged = [
      [fechaReservaTimestamp, normalizeTimestampInput(current.fecha_reserva)],
      [fechaSalida, normalizeTimestampInput(current.fecha_salida) || normalizeTimestampInput(current.fecha_reserva)],
      [fechaLlegada, normalizeTimestampInput(current.fecha_llegada) || normalizeTimestampInput(current.fecha_reserva)],
      [fechaServicio, normalizeTimestampInput(current.fecha_servicio) || normalizeTimestampInput(current.fecha_salida) || normalizeTimestampInput(current.fecha_reserva)],
    ].some(([next, previous]) => next !== previous);

    if (!(await isReservaEstadoValido(estadoFinal))) {
      return res.status(400).json({ error: "Estado de viaje inválido" });
    }

    if (["cancelada", "finalizada"].includes(String(current.estado || "").toLowerCase())) {
      return res.status(400).json({ error: "No puedes reprogramar una reserva cancelada o finalizada" });
    }
    if (current.estado_operativo === "en_curso" && (servicioCambiado || scheduleChanged)) {
      return res.status(409).json({ error: "El viaje ya comenzó. No se pueden editar la ruta, los pasajeros ni el horario; registra una incidencia operativa." });
    }
    if (rutaCambiada && (current.estado_pago === "pagado" || Number(current.monto_pagado) > 0)) {
      return res.status(409).json({ error: "Una reserva con pagos no puede cambiar de ruta directamente. El cliente debe solicitar el cambio de destino." });
    }
    if (servicioCambiado) {
      const pendingPayments = await pool.query(
        "SELECT id FROM pagos_reserva WHERE reserva_id = $1 AND estado = 'pendiente' LIMIT 1",
        [reservaId]
      );
      if (pendingPayments.rowCount) {
        return res.status(409).json({ error: "No se puede cambiar el servicio mientras haya comprobantes de pago pendientes de revisión." });
      }
    }
    if ((current.estado_pago === "pagado" || Number(current.monto_pagado) > 0) && servicioCambiado) {
      return res.status(409).json({ error: "Una reserva con pagos no puede cambiar su servicio o precio directamente." });
    }

    if (scheduleChanged) {
      const activeOperations = await pool.query(
        `SELECT id FROM operaciones
         WHERE reserva_id = $1 AND estado IN ('programada', 'asignada', 'incidencia')
         LIMIT 1`,
        [reservaId]
      );
      if (activeOperations.rowCount) {
        return res.status(409).json({
          error: "No se puede cambiar la fecha mientras haya operaciones activas. Cancela o reprograma las operaciones desde Despacho primero.",
        });
      }
    }

    const userResult = await pool.query("SELECT id FROM usuarios WHERE id = $1 LIMIT 1", [usuarioId]);

    if (userResult.rowCount === 0) {
      return res.status(404).json({ error: "Usuario no encontrado" });
    }

    let tour = null;
    let total = Number(current.total || 0);

    if (tourId) {
      tour = await getTourInfo(tourId);

      if (!tour) {
        return res.status(404).json({ error: "Tour no encontrado" });
      }

      const ocupacion = await validateTourCapacity({
        tourId,
        fechaReserva,
        numPersonas,
        excludeReservaId: reservaId,
      });

      if (ocupacion > Number(tour.capacidad || 0)) {
        return res.status(400).json({
          error: "No hay capacidad suficiente para ese tour en la fecha indicada",
        });
      }

      total = Number(tour.precio) * Number(numPersonas);
    }

    await validateVehiculoDisponible({
      vehiculoId,
      fechaReserva,
      reservaId,
    });

    await validateConductorDisponible({
      conductorId,
      fechaReserva,
      reservaId,
    });

    const optionalColumns = [
      "origen",
      "destino",
      "fecha_salida",
      "fecha_llegada",
      "fecha_servicio",
      "origen_lat",
      "origen_lng",
      "destino_lat",
      "destino_lng",
    ];

    const optionalSetClauses = [];
    const optionalValues = [];

    for (const columnName of optionalColumns) {
      const info = await getReservasColumnInfo(columnName);
      if (!info.exists) continue;
      if (!(columnName in req.body)) continue;

      let value = req.body[columnName];
      if (columnName === "fecha_salida") value = fechaSalida;
      if (columnName === "fecha_llegada") value = fechaLlegada;
      if (columnName === "fecha_servicio") value = fechaServicio;

      optionalValues.push(value);
      const placeholder = `$${9 + optionalValues.length}`;
      if (columnName === "fecha_salida" || columnName === "fecha_llegada" || columnName === "fecha_servicio") {
        optionalSetClauses.push(`${columnName} = ${placeholder}::timestamp`);
      } else {
        optionalSetClauses.push(`${columnName} = ${placeholder}`);
      }
    }

    const optionalSql = optionalSetClauses.length > 0 ? `,\n           ${optionalSetClauses.join(",\n           ")}` : "";

    const updateResult = await pool.query(
      `UPDATE reservas
       SET usuario_id = $1,
           tour_id = $2,
           conductor_id = $3,
           vehiculo_id = $4,
           fecha_reserva = $5,
           num_personas = $6,
           total = $7,
           estado = $8${optionalSql}
       WHERE id = $${9 + optionalValues.length}
       RETURNING *`,
      [
        usuarioId,
        tourId,
        conductorId,
        vehiculoId,
        fechaReserva,
        numPersonas,
        total,
        estadoFinal,
        ...optionalValues,
        reservaId,
      ]
    );

    return res.status(200).json({
      message: "Reserva actualizada correctamente",
      reserva: updateResult.rows[0],
    });
  } catch (error) {
    console.error("Error editando reserva:", error);
    return res.status(500).json({ error: error.message || "Error interno del servidor" });
  }
};

const eliminarReserva = async (req, res) => {
  const reservaId = parsePositiveInt(req.params.id);

  if (!reservaId) {
    return res.status(400).json({ error: "ID de reserva inválido" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const reservation = await client.query("SELECT id FROM reservas WHERE id = $1 FOR UPDATE", [reservaId]);
    if (!reservation.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Reserva no encontrada" });
    }
    const related = await client.query(
      `SELECT
         EXISTS (SELECT 1 FROM pagos_reserva WHERE reserva_id = $1) AS tiene_pagos,
         EXISTS (SELECT 1 FROM operaciones WHERE reserva_id = $1) AS tiene_operaciones,
         EXISTS (SELECT 1 FROM reserva_historial WHERE reserva_id = $1) AS tiene_historial`,
      [reservaId]
    );
    if (related.rowCount && (related.rows[0].tiene_pagos || related.rows[0].tiene_operaciones || related.rows[0].tiene_historial)) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Esta reserva tiene pagos, operaciones o historial. Cancélala para conservar la trazabilidad; no se puede eliminar." });
    }
    await client.query("DELETE FROM reservas WHERE id = $1", [reservaId]);
    await client.query("COMMIT");
    return res.status(200).json({ message: "Reserva eliminada correctamente" });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error eliminando reserva:", error);
    return res.status(500).json({ error: "Error interno del servidor" });
  } finally {
    client.release();
  }
};

const verEstadoViaje = async (req, res) => {
  const reservaId = parsePositiveInt(req.params.id);

  if (!reservaId) {
    return res.status(400).json({ error: "ID de reserva inválido" });
  }

  try {
    await syncReservaEstadosAutomaticos();

    const result = await pool.query(
      `SELECT id, estado, fecha_reserva, vehiculo_id, conductor_id
       FROM reservas
       WHERE id = $1
       LIMIT 1`,
      [reservaId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Reserva no encontrada" });
    }

    return res.status(200).json(result.rows[0]);
  } catch (error) {
    console.error("Error obteniendo estado del viaje:", error);
    return res.status(500).json({ error: "Error interno del servidor" });
  }
};

const actualizarEstadoViaje = async (req, res) => {
  const reservaId = parsePositiveInt(req.params.id);
  const { estado } = req.body;
  const transitions: Record<string, string[]> = {
    pendiente: ["confirmada", "cancelada"],
    pendiente_pago: ["confirmada", "cancelada"],
    confirmada: ["en_curso", "cancelada"],
    en_curso: ["finalizada"],
    finalizada: [],
    cancelada: [],
  };

  if (!reservaId || !estado) {
    return res.status(400).json({ error: "Debes enviar id y estado" });
  }

  if (!(await isReservaEstadoValido(estado))) {
    return res.status(400).json({ error: "Estado de viaje inválido" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const reservaActual = await client.query(
      "SELECT id, usuario_id, total, estado, estado_pago, estado_operativo, recogido FROM reservas WHERE id = $1 FOR UPDATE",
      [reservaId]
    );
    if (!reservaActual.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Reserva no encontrada" });
    }
    const current = reservaActual.rows[0];
    const motivo = typeof req.body?.motivo === "string" ? req.body.motivo.trim() : "";
    const correction = current.estado === "confirmada"
      && current.estado_operativo === "en_curso"
      && estado === "confirmada";
    if (correction) {
      if (motivo.length < 10 || motivo.length > 500) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "La corrección requiere un motivo de al menos 10 caracteres" });
      }
      if (current.recogido) {
        await client.query("ROLLBACK");
        return res.status(409).json({ error: "No se puede revertir el estado después de registrar la recogida del cliente" });
      }
      const startedOperation = await client.query(
        `SELECT id FROM operaciones
         WHERE reserva_id = $1 AND estado IN ('en_curso', 'completada')
         LIMIT 1`,
        [reservaId]
      );
      if (startedOperation.rowCount) {
        await client.query("ROLLBACK");
        return res.status(409).json({ error: "El despacho indica que el viaje ya comenzó o terminó; no se puede revertir desde reservas" });
      }
      const driverStarted = await client.query(
        `SELECT id FROM reserva_historial
         WHERE reserva_id = $1 AND accion = 'inicio_viaje_conductor'
         LIMIT 1`,
        [reservaId]
      );
      if (driverStarted.rowCount) {
        await client.query("ROLLBACK");
        return res.status(409).json({ error: "El conductor ya registró el inicio. No se puede revertir desde reservas" });
      }
    } else if (!transitions[current.estado]?.includes(estado)) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: `No se puede cambiar de '${current.estado}' a '${estado}'` });
    }
    if (current.estado_operativo === "en_curso" && estado === "cancelada") {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "El viaje ya comenzó. Gestiona la situación como una incidencia operativa, no como una cancelación previa al servicio." });
    }
    if (["en_curso", "finalizada"].includes(estado)) {
      await client.query("ROLLBACK");
      return res.status(403).json({ error: "El inicio y la finalización del viaje se gestionan desde el portal del conductor" });
    }
    if (estado === "confirmada" && Number(current.total) > 0 && current.estado_pago !== "pagado") {
        await client.query("ROLLBACK");
        return res.status(400).json({
          error: "No puedes confirmar una reserva sin el pago completo confirmado",
        });
    }

    const result = correction
      ? await client.query(
        "UPDATE reservas SET estado_operativo = NULL, recogido = false WHERE id = $1 RETURNING id, estado, estado_operativo",
        [reservaId]
      )
      : await client.query(
        "UPDATE reservas SET estado = $1, estado_operativo = CASE WHEN $1 = 'cancelada' THEN 'cancelada' ELSE estado_operativo END WHERE id = $2 RETURNING id, estado, estado_operativo",
        [estado, reservaId]
      );

    if (estado === "cancelada") {
      const operations = await client.query(
        `WITH affected AS (
           SELECT id, estado FROM operaciones
           WHERE reserva_id = $1 AND estado IN ('programada', 'asignada', 'incidencia')
           FOR UPDATE
         )
         UPDATE operaciones o SET estado = 'cancelada', actualizado_en = CURRENT_TIMESTAMP
         FROM affected a WHERE o.id = a.id
         RETURNING o.id, a.estado AS estado_anterior`,
        [reservaId]
      );
      for (const operation of operations.rows) {
        await client.query(
          `INSERT INTO operacion_historial (operacion_id, usuario_id, accion, estado_anterior, estado_nuevo, detalle)
           VALUES ($1, $2, 'cancelacion_reserva_admin', $3, 'cancelada', $4::jsonb)`,
          [operation.id, req.user?.id || null, operation.estado_anterior, JSON.stringify({ reserva_id: reservaId })]
        );
      }
    }
    await client.query(
      `INSERT INTO reserva_historial (reserva_id, usuario_id, accion, estado_anterior, estado_nuevo, detalle)
       VALUES ($1, $2, 'cambio_estado_admin', $3, $4, $5::jsonb)`,
      [
        reservaId,
        req.user?.id || null,
        correction ? "en_curso" : current.estado,
        correction ? "confirmada" : estado,
        JSON.stringify(correction ? { motivo_correccion: motivo } : {}),
      ]
    );
    await client.query("COMMIT");

    // Avisar al cliente (campanita + correo) si el admin cambia a un estado clave.
    const estadoNuevo = correction ? "confirmada" : String(result.rows[0].estado || "").toLowerCase();
    if (["confirmada", "en_curso", "finalizada", "cancelada"].includes(estadoNuevo)) {
      await notificarClienteReserva(reservaId, estadoNuevo as any, req.user?.id);
    }

    return res.status(200).json({
      message: "Estado del viaje actualizado",
      viaje: result.rows[0],
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error actualizando estado del viaje:", error);
    return res.status(500).json({ error: "Error interno del servidor" });
  } finally {
    client.release();
  }
};

const listarRutasConductorDesdeReservas = async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT
         rcr.id,
         rcr.conductor_usuario_id AS usuario_id,
         NULL::int AS tour_id,
         rcr.vehiculo_id,
         rcr.conductor_usuario_id AS conductor_id,
         rcr.fecha_viaje AS fecha_reserva,
         1 AS num_personas,
         rcr.valor_cobrado AS total,
         'finalizada' AS estado,
         rcr.creado_en AS fecha_creacion,
         CONCAT(rcr.origen_provincia, ', ', COALESCE(rcr.origen_detalle, '')) AS origen,
         CONCAT(rcr.destino_provincia, ', ', COALESCE(rcr.destino_detalle, '')) AS destino,
         rcr.fecha_viaje AS fecha_salida,
         rcr.fecha_viaje AS fecha_llegada,
         rcr.fecha_viaje AS fecha_servicio,
         u.nombre AS usuario_nombre,
         u.email AS usuario_email,
         NULL AS tour_titulo,
         v.placa AS vehiculo_placa,
         v.modelo AS vehiculo_modelo,
         u.nombre AS conductor_nombre,
         rcr.cliente_nombre,
         rcr.calificacion_cliente,
         rcr.duracion_valor,
         rcr.duracion_unidad,
         rcr.costo_combustible,
         'ruta_reportada' AS tipo_registro
       FROM rutas_conductor_reportes rcr
       INNER JOIN usuarios u ON u.id = rcr.conductor_usuario_id
       LEFT JOIN vehiculos v ON v.id = rcr.vehiculo_id
       ORDER BY rcr.fecha_viaje DESC, rcr.id DESC`
    );

    return res.status(200).json(result.rows);
  } catch (error) {
    console.error("Error listando rutas de conductores:", error);
    return res.status(500).json({ error: "Error interno del servidor" });
  }
};

module.exports = {
  getCatalogo,
  listarReservas,
  crearReserva,
  editarReserva,
  eliminarReserva,
  verEstadoViaje,
  actualizarEstadoViaje,
  listarRutasConductorDesdeReservas,
};
