export {};

const pool = require("../config/db");
const { syncReservaEstadosAutomaticos } = require("../config/reservaEstadoAuto");
const { crearNotificacion } = require("../config/notificaciones");
const { notificarClienteReserva } = require("../config/reservaMailer");

const parsePositiveInt = (value) => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
};

const parseIsoDate = (value) => {
  const date = String(value || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const parsed = new Date(`${date}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date ? date : null;
};

const parseTime = (value) => {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || !/^\d{2}:\d{2}$/.test(value)) return null;
  const [hours, minutes] = value.split(":").map(Number);
  return hours < 24 && minutes < 60 ? value : null;
};

const listarDisponibilidadExterna = async (req, res) => {
  const conductorId = parsePositiveInt(req.params.id);
  if (!conductorId) return res.status(400).json({ error: "ID de conductor inválido" });
  try {
    const result = await pool.query(
      `SELECT d.*, v.placa, v.modelo
       FROM disponibilidad_externa d
       JOIN vehiculos v ON v.id = d.vehiculo_id
       WHERE d.conductor_usuario_id = $1 AND d.estado = 'activo'
       ORDER BY d.fecha_inicio ASC, d.hora_inicio ASC NULLS LAST, d.id DESC
       LIMIT 100`,
      [conductorId]
    );
    return res.json(result.rows);
  } catch (error) {
    console.error("Error listando disponibilidad externa:", error);
    return res.status(500).json({ error: "No se pudo cargar la disponibilidad externa" });
  }
};

const crearDisponibilidadExterna = async (req, res) => {
  const conductorId = parsePositiveInt(req.params.id);
  const requestedVehicleId = parsePositiveInt(req.body?.vehiculo_id);
  const fechaInicio = parseIsoDate(req.body?.fecha_inicio);
  const fechaFin = parseIsoDate(req.body?.fecha_fin || req.body?.fecha_inicio);
  const horaInicio = parseTime(req.body?.hora_inicio);
  const horaFin = parseTime(req.body?.hora_fin);
  const motivo = ["viaje_externo", "ocupado", "fuera_de_servicio"].includes(req.body?.motivo)
    ? req.body.motivo : null;
  const hasInvalidText = (value, max) => value !== null && value !== undefined && value !== ""
    && (typeof value !== "string" || value.trim().length > max);
  const text = (value, max) => typeof value === "string" ? value.trim() || null : null;
  const clienteEmpresa = text(req.body?.cliente_empresa, 160);
  const origen = text(req.body?.origen, 300);
  const destino = text(req.body?.destino, 300);
  const notas = text(req.body?.notas, 1000);
  if (!conductorId || !fechaInicio || !fechaFin || fechaFin < fechaInicio || !motivo
    || (req.body?.hora_inicio !== undefined && req.body?.hora_inicio !== null && req.body?.hora_inicio !== "" && !horaInicio)
    || (req.body?.hora_fin !== undefined && req.body?.hora_fin !== null && req.body?.hora_fin !== "" && !horaFin)
    || hasInvalidText(req.body?.cliente_empresa, 160)
    || hasInvalidText(req.body?.origen, 300)
    || hasInvalidText(req.body?.destino, 300)
    || hasInvalidText(req.body?.notas, 1000)
    || ((horaInicio === null) !== (horaFin === null))
    || (horaInicio && horaFin && horaFin <= horaInicio)) {
    return res.status(400).json({ error: "Revisa las fechas, horario y motivo del bloqueo" });
  }
  try {
    const assignedVehicles = await getVehiculosCompletos(conductorId);
    const vehicle = requestedVehicleId
      ? assignedVehicles.find((item) => Number(item.id) === requestedVehicleId)
      : assignedVehicles[0];
    if (!vehicle) return res.status(409).json({ error: "El vehículo seleccionado no está asociado contigo" });
    const vehicleId = vehicle.id;
    const conflict = await pool.query(
      `SELECT id FROM disponibilidad_externa
       WHERE vehiculo_id = $1 AND estado = 'activo'
         AND fecha_inicio <= $3::date AND fecha_fin >= $2::date
         AND (
           $2::date <> $3::date OR hora_inicio IS NULL OR $4::time IS NULL
           OR hora_fin IS NULL OR $5::time IS NULL
           OR (hora_inicio < $5::time AND $4::time < hora_fin)
         )
       LIMIT 1`,
      [vehicleId, fechaInicio, fechaFin, horaInicio, horaFin]
    );
    if (conflict.rowCount) return res.status(409).json({ error: "Ya existe un bloqueo externo que se cruza con ese horario" });
    const saved = await pool.query(
      `INSERT INTO disponibilidad_externa
       (vehiculo_id, conductor_usuario_id, fecha_inicio, fecha_fin, hora_inicio, hora_fin, motivo, cliente_empresa, origen, destino, notas)
       VALUES ($1, $2, $3::date, $4::date, $5::time, $6::time, $7, $8, $9, $10, $11)
       RETURNING *`,
      [vehicleId, conductorId, fechaInicio, fechaFin, horaInicio, horaFin, motivo, clienteEmpresa, origen, destino, notas]
    );
    return res.status(201).json({ message: "Disponibilidad externa registrada", data: saved.rows[0] });
  } catch (error) {
    console.error("Error creando disponibilidad externa:", error);
    return res.status(500).json({ error: "No se pudo registrar la disponibilidad externa" });
  }
};

const cancelarDisponibilidadExterna = async (req, res) => {
  const conductorId = parsePositiveInt(req.params.id);
  const blockId = parsePositiveInt(req.params.bloqueoId);
  if (!conductorId || !blockId) return res.status(400).json({ error: "Identificadores inválidos" });
  try {
    const result = await pool.query(
      `UPDATE disponibilidad_externa SET estado = 'cancelado', actualizado_en = CURRENT_TIMESTAMP
       WHERE id = $1 AND conductor_usuario_id = $2 AND estado = 'activo'
       RETURNING id`,
      [blockId, conductorId]
    );
    if (!result.rowCount) return res.status(404).json({ error: "Bloqueo externo no encontrado" });
    return res.json({ message: "Bloqueo externo cancelado" });
  } catch (error) {
    console.error("Error cancelando disponibilidad externa:", error);
    return res.status(500).json({ error: "No se pudo cancelar el bloqueo externo" });
  }
};

const hasReservasColumn = async (columnName) => {
  const result = await pool.query(
    `SELECT 1
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'reservas'
       AND column_name = $1
     LIMIT 1`,
    [columnName]
  );
  return result.rowCount > 0;
};

const buildReservaExtraSelects = async () => {
  const [hasOrigen, hasDestino, hasFechaSalida, hasFechaLlegada] = await Promise.all([
    hasReservasColumn("origen"),
    hasReservasColumn("destino"),
    hasReservasColumn("fecha_salida"),
    hasReservasColumn("fecha_llegada"),
  ]);

  return {
    origen: hasOrigen ? "r.origen AS origen" : "NULL AS origen",
    destino: hasDestino ? "r.destino AS destino" : "NULL AS destino",
    fechaSalida: hasFechaSalida ? "r.fecha_salida AS fecha_salida" : "NULL AS fecha_salida",
    fechaLlegada: hasFechaLlegada ? "r.fecha_llegada AS fecha_llegada" : "NULL AS fecha_llegada",
  };
};

const getConductorActivo = async (conductorId) => {
  const result = await pool.query(
    `SELECT id
     FROM usuarios
     WHERE id = $1
       AND LOWER(rol) IN ('conductor', 'vehiculo')
     LIMIT 1`,
    [conductorId]
  );
  return result.rowCount ? result.rows[0] : null;
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

const resolveReservaConductorId = async (conductorUserId) => {
  const targetTable = await getReservasConductorForeignTarget();

  // Esquema moderno: reservas.conductor_id -> usuarios.id
  if (targetTable === "usuarios") {
    return conductorUserId;
  }

  // Esquema legado: reservas.conductor_id -> conductores.id
  if (targetTable === "conductores") {
    const hasUsuarioId = await hasTableColumn("conductores", "usuario_id");
    if (hasUsuarioId) {
      const byUsuarioId = await pool.query(
        `SELECT id
         FROM conductores
         WHERE usuario_id = $1
         LIMIT 1`,
        [conductorUserId]
      );
      if (byUsuarioId.rowCount) return Number(byUsuarioId.rows[0].id);

      const hasEstado = await hasTableColumn("conductores", "estado");
      const hasLicencia = await hasTableColumn("conductores", "licencia");
      let insertSql = `INSERT INTO conductores (usuario_id) VALUES ($1) ON CONFLICT (usuario_id) DO UPDATE SET usuario_id = EXCLUDED.usuario_id RETURNING id`;

      if (hasLicencia && hasEstado) {
        insertSql = `INSERT INTO conductores (usuario_id, licencia, estado) VALUES ($1, 'LIC-' || $1::text, 'disponible') ON CONFLICT (usuario_id) DO UPDATE SET usuario_id = EXCLUDED.usuario_id RETURNING id`;
      } else if (hasLicencia) {
        insertSql = `INSERT INTO conductores (usuario_id, licencia) VALUES ($1, 'LIC-' || $1::text) ON CONFLICT (usuario_id) DO UPDATE SET usuario_id = EXCLUDED.usuario_id RETURNING id`;
      } else if (hasEstado) {
        insertSql = `INSERT INTO conductores (usuario_id, estado) VALUES ($1, 'disponible') ON CONFLICT (usuario_id) DO UPDATE SET usuario_id = EXCLUDED.usuario_id RETURNING id`;
      }

      try {
        const created = await pool.query(insertSql, [conductorUserId]);
        if (created.rowCount) return Number(created.rows[0].id);
      } catch (_error) {
        // Si no se pudo crear automáticamente, continúa con otros métodos de búsqueda.
      }
    }

    const hasUserId = await hasTableColumn("conductores", "user_id");
    if (hasUserId) {
      const byUserId = await pool.query(
        `SELECT id
         FROM conductores
         WHERE user_id = $1
         LIMIT 1`,
        [conductorUserId]
      );
      if (byUserId.rowCount) return Number(byUserId.rows[0].id);
    }

    const hasEmail = await hasTableColumn("conductores", "email");
    if (hasEmail) {
      const byEmail = await pool.query(
        `SELECT c.id
         FROM conductores c
         INNER JOIN usuarios u ON u.id = $1
         WHERE LOWER(c.email) = LOWER(u.email)
         LIMIT 1`,
        [conductorUserId]
      );
      if (byEmail.rowCount) return Number(byEmail.rows[0].id);
    }

    // Fallback: si el id coincide directamente en tabla conductores.
    const byDirectId = await pool.query(
      `SELECT id
       FROM conductores
       WHERE id = $1
       LIMIT 1`,
      [conductorUserId]
    );
    if (byDirectId.rowCount) return Number(byDirectId.rows[0].id);

    return null;
  }

  // Si hay un esquema no esperado, preserva comportamiento anterior.
  return conductorUserId;
};

const getVehiculoActivoDelConductor = async (conductorId) => {
  const result = await pool.query(
    `SELECT id, placa
     FROM vehiculos
     WHERE usuario_id = $1
       AND activo = true
       AND estado = 'disponible'
     ORDER BY id ASC
     LIMIT 1`,
    [conductorId]
  );

  return result.rowCount ? result.rows[0] : null;
};

const getVehiculoByUsuarioId = async (usuarioId) => {
  const result = await pool.query(
    `SELECT id
     FROM vehiculos
     WHERE usuario_id = $1
       AND activo = true
     ORDER BY id ASC
     LIMIT 1`,
    [usuarioId]
  );

  return result.rowCount ? Number(result.rows[0].id) : null;
};

const getConductorRegistroByUsuarioId = async (usuarioId) => {
  const result = await pool.query(
    `SELECT id, rating_promedio, viajes_completados
     FROM conductores
     WHERE usuario_id = $1
     LIMIT 1`,
    [usuarioId]
  );

  return result.rowCount ? result.rows[0] : null;
};

const normalizeText = (value, maxLength = 200) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : null;
};

const parseOptionalNumber = (value) => {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const crearReporteRutaConductor = async (req, res) => {
  const conductorId = parsePositiveInt(req.params.id);

  if (!conductorId) {
    return res.status(400).json({ error: "ID de conductor inválido" });
  }

  try {
    const conductor = await getConductorActivo(conductorId);

    if (!conductor) {
      return res.status(404).json({ error: "Conductor no encontrado" });
    }

    const conductorRegistro = await getConductorRegistroByUsuarioId(conductorId);

    if (!conductorRegistro) {
      return res.status(400).json({ error: "Conductor no configurado en la tabla de conductores" });
    }

    const origenProvincia = normalizeText(req.body.origen_provincia, 120);
    const destinoProvincia = normalizeText(req.body.destino_provincia, 120);

    if (!origenProvincia || !destinoProvincia) {
      return res.status(400).json({ error: "Debes completar provincia de origen y destino" });
    }

    const duracionValor = parseOptionalNumber(req.body.duracion_valor);
    const duracionUnidad = String(req.body.duracion_unidad || "horas").trim().toLowerCase();
    const costoCombustible = parseOptionalNumber(req.body.costo_combustible) ?? 0;
    const valorCobrado = parseOptionalNumber(req.body.valor_cobrado) ?? 0;
    const calificacionCliente = parseOptionalNumber(req.body.calificacion_cliente);
    const fechaViaje = normalizeText(req.body.fecha_viaje, 10) || new Date().toISOString().slice(0, 10);
    const observaciones = normalizeText(req.body.observaciones, 2000);
    const clienteNombre = normalizeText(req.body.cliente_nombre, 200);
    const clienteTelefono = normalizeText(req.body.cliente_telefono, 50);
    const clienteEmail = normalizeText(req.body.cliente_email, 200);
    const origenCanton = normalizeText(req.body.origen_canton, 120);
    const origenParroquia = normalizeText(req.body.origen_parroquia, 120);
    const origenDetalle = normalizeText(req.body.origen_detalle, 200);
    const destinoCanton = normalizeText(req.body.destino_canton, 120);
    const destinoParroquia = normalizeText(req.body.destino_parroquia, 120);
    const destinoDetalle = normalizeText(req.body.destino_detalle, 200);

    if (calificacionCliente !== null && (calificacionCliente < 0 || calificacionCliente > 5)) {
      return res.status(400).json({ error: "La calificación del cliente debe estar entre 0 y 5" });
    }

    if (duracionUnidad !== "horas" && duracionUnidad !== "dias") {
      return res.status(400).json({ error: "La duración debe expresarse en horas o días" });
    }

    const duracionMinutosEquivalentes =
      duracionValor === null
        ? null
        : Math.round(duracionUnidad === "dias" ? duracionValor * 24 * 60 : duracionValor * 60);

    const vehiculoId = await getVehiculoByUsuarioId(conductorId);

    const insertResult = await pool.query(
      `INSERT INTO rutas_conductor_reportes (
         conductor_usuario_id,
         conductor_id,
         vehiculo_id,
         fecha_viaje,
         origen_provincia,
         origen_canton,
         origen_parroquia,
         origen_detalle,
         destino_provincia,
         destino_canton,
         destino_parroquia,
         destino_detalle,
         duracion_valor,
         duracion_unidad,
         duracion_minutos_equivalentes,
         costo_combustible,
         valor_cobrado,
         calificacion_cliente,
         cliente_nombre,
         cliente_telefono,
         cliente_email,
         observaciones
       ) VALUES (
         $1, $2, $3, $4::date, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22
       )
       RETURNING *`,
      [
        conductorId,
        conductorRegistro.id,
        vehiculoId,
        fechaViaje,
        origenProvincia,
        origenCanton,
        origenParroquia,
        origenDetalle,
        destinoProvincia,
        destinoCanton,
        destinoParroquia,
        destinoDetalle,
        duracionValor,
        duracionUnidad,
        duracionMinutosEquivalentes,
        costoCombustible,
        valorCobrado,
        calificacionCliente,
        clienteNombre,
        clienteTelefono,
        clienteEmail,
        observaciones,
      ]
    );

    const resumen = await pool.query(
      `SELECT
         COUNT(*)::int AS total_reportes,
         AVG(calificacion_cliente)::numeric(3,2) AS rating_promedio,
         SUM(valor_cobrado)::numeric(10,2) AS ingresos_totales
       FROM rutas_conductor_reportes
       WHERE conductor_usuario_id = $1`,
      [conductorId]
    );

    const totalReportes = Number(resumen.rows[0]?.total_reportes || 0);
    const promedioRating = resumen.rows[0]?.rating_promedio !== null ? Number(resumen.rows[0].rating_promedio) : null;

    if (promedioRating !== null) {
      await pool.query(
        `UPDATE conductores
         SET rating_promedio = $1,
             viajes_completados = COALESCE(viajes_completados, 0) + 1
         WHERE usuario_id = $3`,
        [promedioRating, conductorId]
      );
    }

    return res.status(201).json({
      success: true,
      data: insertResult.rows[0],
      resumen: resumen.rows[0],
      message: "Reporte de ruta guardado correctamente",
    });
  } catch (error) {
    console.error("Error creando reporte de ruta:", error);
    return res.status(500).json({ error: "Error interno del servidor" });
  }
};

const listarReportesRutaConductor = async (req, res) => {
  const conductorId = parsePositiveInt(req.params.id);

  if (!conductorId) {
    return res.status(400).json({ error: "ID de conductor inválido" });
  }

  try {
    const conductor = await getConductorActivo(conductorId);

    if (!conductor) {
      return res.status(404).json({ error: "Conductor no encontrado" });
    }

    const result = await pool.query(
      `SELECT
         id,
         fecha_viaje,
         origen_provincia,
         origen_canton,
         origen_parroquia,
         origen_detalle,
         destino_provincia,
         destino_canton,
         destino_parroquia,
         destino_detalle,
         duracion_valor,
         duracion_unidad,
         duracion_minutos_equivalentes,
         costo_combustible,
         valor_cobrado,
         calificacion_cliente,
         cliente_nombre,
         cliente_telefono,
         cliente_email,
         observaciones,
         creado_en
       FROM rutas_conductor_reportes
       WHERE conductor_usuario_id = $1
       ORDER BY creado_en DESC
       LIMIT 50`,
      [conductorId]
    );

    return res.status(200).json({
      success: true,
      data: result.rows,
      total: result.rows.length,
    });
  } catch (error) {
    console.error("Error listando reportes de ruta de conductor:", error);
    return res.status(500).json({ error: "Error interno del servidor" });
  }
};

const getReservaActivaMismaFecha = async ({ conductorId, fechaReserva, excludeReservaId }) => {
  const result = await pool.query(
    `SELECT id, fecha_reserva, estado
     FROM reservas
     WHERE conductor_id = $1
       AND fecha_reserva = $2
       AND estado IN ('confirmada', 'en_curso')
       AND id <> $3
     ORDER BY id DESC
     LIMIT 1`,
    [conductorId, fechaReserva, excludeReservaId]
  );

  return result.rowCount ? result.rows[0] : null;
};

const getVehiculoCompleto = async (usuarioId) => {
  // La interfaz administrativa identifica al conductor desde vehiculos.usuario_id.
  // Dar prioridad a esa relación evita mostrar una asignación histórica que no
  // coincida con el vehículo que administración tiene asignado actualmente.
  const byUsuario = await pool.query(
    `SELECT id, placa, modelo, tipo, estado, capacidad, color, imagen_url,
            descripcion, marca, anio, kilometraje,
            fecha_proximo_mantenimiento, proximo_km_mantenimiento
     FROM vehiculos
     WHERE usuario_id = $1
       AND activo = true
     ORDER BY id DESC
     LIMIT 1`,
    [usuarioId]
  );
  if (byUsuario.rowCount) return byUsuario.rows[0];

  // Compatibilidad con asignaciones registradas en asignacion_vehiculos.
  const byAsignacion = await pool.query(
    `SELECT v.id, v.placa, v.modelo, v.tipo, v.estado, v.capacidad, v.color,
            v.imagen_url, v.descripcion, v.marca, v.anio, v.kilometraje,
            v.fecha_proximo_mantenimiento, v.proximo_km_mantenimiento
     FROM asignacion_vehiculos av
     JOIN conductores c ON c.id = av.conductor_id
     JOIN vehiculos v   ON v.id = av.vehiculo_id
     WHERE c.usuario_id = $1
       AND av.estado = 'activa'
       AND v.activo = true
     ORDER BY av.id DESC
     LIMIT 1`,
    [usuarioId]
  );
  return byAsignacion.rowCount ? byAsignacion.rows[0] : null;
};

const getVehiculosCompletos = async (usuarioId) => {
  const result = await pool.query(
    `SELECT DISTINCT v.id, v.placa, v.modelo, v.tipo, v.estado, v.capacidad, v.color,
            v.imagen_url, v.descripcion, v.marca, v.anio, v.kilometraje,
            v.fecha_proximo_mantenimiento, v.proximo_km_mantenimiento
     FROM vehiculos v
     LEFT JOIN conductores c ON c.usuario_id = $1
     LEFT JOIN asignacion_vehiculos av
       ON av.conductor_id = c.id AND av.vehiculo_id = v.id AND av.estado = 'activa'
     WHERE v.activo = true
       AND (v.usuario_id = $1 OR av.id IS NOT NULL)
     ORDER BY v.id DESC`,
    [usuarioId]
  );
  return result.rows;
};

const listarReservasConductor = async (req, res) => {
  const conductorId = parsePositiveInt(req.params.id);

  if (!conductorId) {
    return res.status(400).json({ error: "ID de conductor inválido" });
  }

  try {
    await syncReservaEstadosAutomaticos();

    const conductor = await getConductorActivo(conductorId);

    if (!conductor) {
      return res.status(404).json({ error: "Conductor no encontrado" });
    }

    const vehiculoAsignado = await getVehiculoCompleto(conductorId);
    // Los viajes activos, el historial y los ingresos deben seguir al VEHÍCULO
    // que el conductor tiene asignado ahora mismo, no a su identidad personal.
    // Así, si el vehículo cambia de conductor, cada uno ve únicamente lo que
    // corresponde a la unidad que está manejando en este momento.
    const vehiculoId = vehiculoAsignado ? Number(vehiculoAsignado.id) : null;

    const conductorReservaId = await resolveReservaConductorId(conductorId);

    if (!conductorReservaId) {
      return res.status(400).json({ error: "Conductor no configurado para reservas" });
    }

    const extraSelects = await buildReservaExtraSelects();

    const [pendientes, activas, historial] = await Promise.all([
      pool.query(
        `SELECT
           r.id,
           r.fecha_reserva,
           r.fecha_fin,
           r.fecha_regreso,
           r.hora_regreso,
           r.ida_finalizada,
           ${extraSelects.fechaSalida},
           ${extraSelects.fechaLlegada},
           ${extraSelects.origen},
           ${extraSelects.destino},
           CASE WHEN r.estado_operativo = 'en_curso' THEN 'en_curso' ELSE r.estado END AS estado,
           r.num_personas,
           r.total,
           r.recogida_lat,
           r.recogida_lng,
           r.referencia_recogida,
           u.nombre AS usuario_nombre,
           u.email AS usuario_email,
           u.telefono AS usuario_telefono,
           COALESCE(u.estado_verificacion, 'no_verificado') AS usuario_verificacion,
           t.titulo AS tour_titulo,
           t.ubicacion AS tour_ubicacion,
           v.placa AS vehiculo_placa
         FROM reservas r
         INNER JOIN usuarios u ON u.id = r.usuario_id
         LEFT JOIN tours t ON t.id = r.tour_id
         LEFT JOIN vehiculos v ON v.id = r.vehiculo_id
         WHERE r.estado IN ('pendiente', 'reprogramacion_pendiente')
           AND r.vehiculo_id = $1
           AND (COALESCE(r.total, 0) <= 0 OR r.estado_pago = 'pagado')
         ORDER BY r.fecha_reserva ASC, r.id ASC`,
        [vehiculoId]
      ),
      pool.query(
        `SELECT
           r.id,
           r.fecha_reserva,
           r.fecha_fin,
           r.fecha_regreso,
           r.hora_regreso,
           r.ida_finalizada,
            ${extraSelects.fechaSalida},
            ${extraSelects.fechaLlegada},
            ${extraSelects.origen},
            ${extraSelects.destino},
           CASE WHEN r.estado_operativo = 'en_curso' THEN 'en_curso' ELSE r.estado END AS estado,
           r.num_personas,
           r.total,
           r.recogida_lat,
           r.recogida_lng,
           r.referencia_recogida,
           u.nombre AS usuario_nombre,
           u.email AS usuario_email,
           u.telefono AS usuario_telefono,
           COALESCE(u.estado_verificacion, 'no_verificado') AS usuario_verificacion,
           t.titulo AS tour_titulo,
           t.ubicacion AS tour_ubicacion,
           v.placa AS vehiculo_placa,
           r.recogido,
           co.hora_salida,
           co.origen_lat, co.origen_lng, co.destino_lat, co.destino_lng
         FROM reservas r
         INNER JOIN usuarios u ON u.id = r.usuario_id
         LEFT JOIN tours t ON t.id = r.tour_id
         LEFT JOIN vehiculos v ON v.id = r.vehiculo_id
         LEFT JOIN cotizaciones co ON co.reserva_id = r.id
         WHERE r.vehiculo_id = $1
           AND r.estado = 'confirmada'
           AND COALESCE(r.estado_operativo, '') <> 'cancelada'
           AND (COALESCE(r.total, 0) <= 0 OR r.estado_pago = 'pagado')
         ORDER BY r.fecha_reserva ASC, r.id ASC`,
        [vehiculoId]
      ),
      pool.query(
        `SELECT
           r.id,
           r.fecha_reserva,
           r.fecha_fin,
            ${extraSelects.fechaSalida},
            ${extraSelects.fechaLlegada},
            ${extraSelects.origen},
            ${extraSelects.destino},
           CASE WHEN r.estado_operativo = 'en_curso' THEN 'en_curso' ELSE r.estado END AS estado,
           r.num_personas,
           r.total,
           u.nombre AS usuario_nombre,
           u.email AS usuario_email,
           u.telefono AS usuario_telefono,
           COALESCE(u.estado_verificacion, 'no_verificado') AS usuario_verificacion,
           t.titulo AS tour_titulo,
           t.ubicacion AS tour_ubicacion,
           v.placa AS vehiculo_placa
         FROM reservas r
         INNER JOIN usuarios u ON u.id = r.usuario_id
         LEFT JOIN tours t ON t.id = r.tour_id
         LEFT JOIN vehiculos v ON v.id = r.vehiculo_id
         WHERE r.vehiculo_id = $1
           AND r.estado IN ('finalizada', 'cancelada')
         ORDER BY r.fecha_reserva DESC, r.id DESC
         LIMIT 30`,
        [vehiculoId]
      ),
    ]);

    // Si no hay vehículo asignado, obtener el estado real del conductor desde la tabla conductores
    let vehiculoRespuesta = vehiculoAsignado;
    if (!vehiculoRespuesta) {
      const conductorEstadoResult = await pool.query(
        `SELECT estado FROM conductores WHERE usuario_id = $1 LIMIT 1`,
        [conductorId]
      );
      const conductorEstado = conductorEstadoResult.rows[0]?.estado || "disponible";
      vehiculoRespuesta = { placa: "SIN VEHÍCULO", modelo: "-", tipo: "-", estado: conductorEstado };
    }

    return res.status(200).json({
      pendientes: pendientes.rows,
      activas: activas.rows,
      historial: historial.rows,
      vehiculo: vehiculoRespuesta,
    });
  } catch (error) {
    console.error("Error listando reservas de conductor:", error);
    return res.status(500).json({ error: "Error interno del servidor" });
  }
};

const listarMisReservasConductor = (req, res) => {
  req.params.id = String(req.user.id);
  return listarReservasConductor(req, res);
};

const aceptarReservaConductor = async (req, res) => {
  const conductorId = parsePositiveInt(req.params.id);
  const reservaId = parsePositiveInt(req.params.reservaId);

  if (!conductorId || !reservaId) {
    return res.status(400).json({ error: "IDs inválidos" });
  }

  try {
    const conductor = await getConductorActivo(conductorId);

    if (!conductor) {
      return res.status(404).json({ error: "Conductor no encontrado" });
    }

    const conductorReservaId = await resolveReservaConductorId(conductorId);

    if (!conductorReservaId) {
      return res.status(400).json({ error: "Conductor no configurado para reservas" });
    }

    const reservaResult = await pool.query(
      `SELECT id, conductor_id, vehiculo_id, estado, fecha_reserva
       FROM reservas
       WHERE id = $1
       LIMIT 1`,
      [reservaId]
    );

    if (reservaResult.rowCount === 0) {
      return res.status(404).json({ error: "Reserva no encontrada" });
    }

    const reserva = reservaResult.rows[0];

    if (reserva.conductor_id && Number(reserva.conductor_id) !== conductorReservaId) {
      return res.status(409).json({ error: "La reserva ya fue tomada por otro conductor" });
    }

    if (["cancelada", "finalizada"].includes(reserva.estado)) {
      return res.status(400).json({ error: "La reserva ya no está disponible para aceptar" });
    }

    const reservaActivaMismaFecha = await getReservaActivaMismaFecha({
      conductorId: conductorReservaId,
      fechaReserva: reserva.fecha_reserva,
      excludeReservaId: reservaId,
    });

    if (reservaActivaMismaFecha) {
      return res.status(409).json({
        error: "Ya tienes una reserva activa en esa fecha. Finalízala antes de aceptar otra.",
      });
    }

    const vehiculoAsignado = await getVehiculoActivoDelConductor(conductorId);

    if (!vehiculoAsignado) {
      return res.status(400).json({
        error: "No tienes vehículo activo disponible para aceptar esta carrera.",
      });
    }

    const updateResult = await pool.query(
      `UPDATE reservas
       SET conductor_id = $1,
           vehiculo_id = $2,
           estado = CASE WHEN estado IN ('pendiente', 'reprogramacion_pendiente') THEN 'confirmada' ELSE estado END
       WHERE id = $3
         AND (conductor_id IS NULL OR conductor_id = $1)
         AND NOT EXISTS (
           SELECT 1
           FROM reservas r2
           WHERE r2.conductor_id = $1
             AND r2.fecha_reserva = $4
             AND r2.estado IN ('confirmada', 'en_curso')
             AND r2.id <> $3
         )
       RETURNING *`,
      [conductorReservaId, vehiculoAsignado.id, reservaId, reserva.fecha_reserva]
    );

    if (updateResult.rowCount === 0) {
      const conflictoMismaFecha = await getReservaActivaMismaFecha({
        conductorId: conductorReservaId,
        fechaReserva: reserva.fecha_reserva,
        excludeReservaId: reservaId,
      });

      if (conflictoMismaFecha) {
        return res.status(409).json({
          error: "Ya tienes una reserva activa en esa fecha. Finalízala antes de aceptar otra.",
        });
      }

      return res.status(409).json({ error: "La reserva ya fue tomada por otro vehículo" });
    }

    // Avisar al cliente (campanita + correo) que un conductor tomó su viaje.
    await notificarClienteReserva(reservaId, "conductor_asignado", conductorId);

    return res.status(200).json({
      message: "Reserva aceptada correctamente",
      reserva: updateResult.rows[0],
    });
  } catch (error) {
    console.error("Error aceptando reserva:", error);
    return res.status(500).json({ error: "Error interno del servidor" });
  }
};

const rechazarReservaConductor = async (req, res) => {
  const conductorId = parsePositiveInt(req.params.id);
  const reservaId = parsePositiveInt(req.params.reservaId);

  if (!conductorId || !reservaId) {
    return res.status(400).json({ error: "IDs inválidos" });
  }

  try {
    const conductorReservaId = await resolveReservaConductorId(conductorId);

    if (!conductorReservaId) {
      return res.status(400).json({ error: "Conductor no configurado para reservas" });
    }

    const reservaResult = await pool.query(
      `SELECT id, conductor_id, estado
       FROM reservas
       WHERE id = $1
       LIMIT 1`,
      [reservaId]
    );

    if (reservaResult.rowCount === 0) {
      return res.status(404).json({ error: "Reserva no encontrada" });
    }

    const reserva = reservaResult.rows[0];

    if (Number(reserva.conductor_id) !== conductorReservaId) {
      return res.status(403).json({ error: "No puedes rechazar una reserva que no te pertenece" });
    }

    if (["en_curso", "finalizada"].includes(reserva.estado)) {
      return res.status(400).json({ error: "No puedes rechazar una reserva en curso o finalizada" });
    }

    const updateResult = await pool.query(
      `UPDATE reservas
       SET conductor_id = NULL,
           vehiculo_id = NULL,
           estado = 'pendiente'
       WHERE id = $1
       RETURNING *`,
      [reservaId]
    );

    return res.status(200).json({
      message: "Reserva liberada correctamente",
      reserva: updateResult.rows[0],
    });
  } catch (error) {
    console.error("Error rechazando reserva:", error);
    return res.status(500).json({ error: "Error interno del servidor" });
  }
};

const actualizarEstadoReservaConductor = async (req, res) => {
  const conductorId = parsePositiveInt(req.params.id);
  const reservaId = parsePositiveInt(req.params.reservaId);
  const estado = String(req.body.estado || "").trim().toLowerCase();

  if (!conductorId || !reservaId || !estado) {
    return res.status(400).json({ error: "Debes enviar IDs válidos y estado" });
  }

  const allowedStates = ["en_curso", "finalizada", "cancelada"];

  if (!allowedStates.includes(estado)) {
    return res.status(400).json({ error: "Estado inválido para conductor" });
  }

  let reservaActualizada;
  let finalizaIda = false;
  let regresoFecha;
  let regresoHora;
  const client = await pool.connect();
  try {
    const conductorReservaId = await resolveReservaConductorId(conductorId);

    if (!conductorReservaId) {
      return res.status(400).json({ error: "Conductor no configurado para reservas" });
    }

    await client.query("BEGIN");
    const reservaResult = await client.query(
      `SELECT id, conductor_id, estado, estado_operativo, estado_pago, total, fecha_regreso, hora_regreso, ida_finalizada, recogido,
              (fecha_regreso IS NOT NULL AND NOW() < fecha_regreso::timestamp + COALESCE(NULLIF(hora_regreso, '')::time, time '00:00')) AS regreso_pendiente
       FROM reservas
       WHERE id = $1
       FOR UPDATE`,
      [reservaId]
    );

    if (reservaResult.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Reserva no encontrada" });
    }

    const reserva = reservaResult.rows[0];

    if (Number(reserva.conductor_id) !== conductorReservaId) {
      await client.query("ROLLBACK");
      return res.status(403).json({ error: "No puedes cambiar estado de una reserva que no te pertenece" });
    }

    if (reserva.estado === "finalizada" || reserva.estado_operativo === "finalizada") {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "La reserva ya está finalizada" });
    }

    if (estado === "en_curso" && (reserva.estado !== "confirmada" || reserva.estado_operativo === "finalizada" || reserva.estado_operativo === "en_curso")) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Para iniciar el viaje, la reserva debe estar confirmada" });
    }

    if (estado === "en_curso" && reserva.ida_finalizada && reserva.regreso_pendiente) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "El regreso aún no está habilitado. Inicia el viaje en la fecha y hora acordadas." });
    }

    if (estado === "en_curso" && Number(reserva.total) > 0 && reserva.estado_pago !== "pagado") {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "El cliente aún no ha completado el pago total para iniciar el viaje" });
    }

    if (estado === "finalizada" && (reserva.estado !== "confirmada" || reserva.estado_operativo !== "en_curso" || !reserva.recogido)) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Para finalizar, el viaje debe estar en curso y el cliente debe haber sido recogido" });
    }

    if (estado === "cancelada" && reserva.estado_operativo === "en_curso") {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "El viaje ya comenzó. Gestiona la situación como una incidencia operativa." });
    }

    regresoFecha = reserva.fecha_regreso;
    regresoHora = reserva.hora_regreso;
    finalizaIda = estado === "finalizada" && Boolean(reserva.fecha_regreso) && !reserva.ida_finalizada;
    const updateResult = await client.query(
      `UPDATE reservas
       SET estado = CASE
             WHEN $1 = 'cancelada' OR ($1 = 'finalizada' AND NOT $2) THEN $1
             ELSE estado
           END,
           estado_operativo = CASE
             WHEN $1 = 'en_curso' THEN 'en_curso'
             WHEN $1 = 'finalizada' AND $2 THEN 'asignada'
             WHEN $1 = 'finalizada' OR $1 = 'cancelada' THEN $1
             ELSE estado_operativo
           END,
           ida_finalizada = CASE WHEN $2 THEN true ELSE ida_finalizada END,
           recogido = CASE WHEN $1 = 'en_curso' OR $2 THEN false ELSE recogido END
       WHERE id = $3
       RETURNING *`,
      [estado, finalizaIda, reservaId]
    );
    reservaActualizada = updateResult.rows[0];

    const historyAction = estado === "en_curso" ? "inicio_viaje_conductor"
      : estado === "finalizada" ? finalizaIda ? "ida_finalizada_conductor" : "finalizacion_viaje_conductor"
        : "cancelacion_viaje_conductor";
    await client.query(
      `INSERT INTO reserva_historial (reserva_id, usuario_id, accion, estado_anterior, estado_nuevo, detalle)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
      [
        reservaId,
        conductorId,
        historyAction,
        reserva.estado_operativo || reserva.estado,
        finalizaIda ? "asignada" : estado,
        JSON.stringify({ origen: "portal_conductor" }),
      ]
    );
    if (estado === "en_curso" || estado === "finalizada" || estado === "cancelada") {
      const nextOperationState = estado === "en_curso" ? "en_curso" : estado === "finalizada" ? finalizaIda ? "asignada" : "completada" : "cancelada";
      const operations = await client.query(
        `UPDATE operaciones
         SET estado = $1, actualizado_en = CURRENT_TIMESTAMP
         WHERE reserva_id = $2 AND requerimiento_id IS NULL
           AND estado IN ('programada', 'asignada', 'en_curso')
         RETURNING id, estado AS estado_nuevo`,
        [nextOperationState, reservaId]
      );
      for (const operation of operations.rows) {
        await client.query(
          `INSERT INTO operacion_historial (operacion_id, usuario_id, accion, estado_nuevo, detalle)
           VALUES ($1, $2, 'actualizacion_conductor', $3, $4::jsonb)`,
          [operation.id, conductorId, operation.estado_nuevo, JSON.stringify({ estado_reserva: estado, ida_finalizada: finalizaIda })]
        );
      }
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch((rollbackError) => {
      console.error("Error revirtiendo actualización operativa:", rollbackError);
    });
    console.error("Error actualizando estado de reserva por conductor:", error);
    return res.status(500).json({ error: "Error interno del servidor" });
  } finally {
    client.release();
  }

  let notificationWarning;
  if (estado === "en_curso" || (estado === "finalizada" && !finalizaIda) || estado === "cancelada") {
    try {
      await notificarClienteReserva(reservaId, estado, conductorId);
    } catch (error) {
      console.error("El estado se actualizó, pero no se pudo notificar al cliente:", error);
      notificationWarning = "El cambio se guardó, pero no se pudo enviar la notificación.";
    }
  }

  return res.status(200).json({
      message: finalizaIda
        ? `Ida finalizada. El regreso queda programado para ${regresoFecha}${regresoHora ? ` a las ${regresoHora}` : ""}.`
        : "Estado actualizado correctamente",
      ...(notificationWarning ? { warning: notificationWarning } : {}),
      reserva: {
        ...reservaActualizada,
        estado: estado === "en_curso" ? "en_curso" : finalizaIda ? "confirmada" : estado,
      },
    });
};

// El conductor marca que ya recogió al cliente: el viaje pasa a su segunda fase
// (ir al destino). Requiere que la reserva sea suya y esté en curso.
const marcarRecogidoConductor = async (req, res) => {
  const conductorId = parsePositiveInt(req.params.id);
  const reservaId = parsePositiveInt(req.params.reservaId);

  if (!conductorId || !reservaId) {
    return res.status(400).json({ error: "Debes enviar IDs válidos" });
  }

  try {
    const conductorReservaId = await resolveReservaConductorId(conductorId);
    if (!conductorReservaId) {
      return res.status(400).json({ error: "Conductor no configurado para reservas" });
    }

    const reservaResult = await pool.query(
      "SELECT id, conductor_id, estado, estado_operativo FROM reservas WHERE id = $1 LIMIT 1",
      [reservaId]
    );
    if (reservaResult.rowCount === 0) {
      return res.status(404).json({ error: "Reserva no encontrada" });
    }

    const reserva = reservaResult.rows[0];
    if (Number(reserva.conductor_id) !== conductorReservaId) {
      return res.status(403).json({ error: "Esta reserva no te pertenece" });
    }
    if (reserva.estado_operativo !== "en_curso") {
      return res.status(400).json({ error: "Solo puedes marcar la recogida en un viaje en curso" });
    }

    const upd = await pool.query(
      `UPDATE reservas SET recogido = true, recogido_en = NOW()
       WHERE id = $1 AND estado = 'confirmada' AND estado_operativo = 'en_curso' AND recogido = false
       RETURNING *`,
      [reservaId]
    );
    if (!upd.rowCount) {
      return res.status(409).json({ error: "El estado del viaje cambió. Actualiza la página e inténtalo nuevamente." });
    }

    return res.status(200).json({ message: "Cliente recogido. Dirígete al destino.", reserva: upd.rows[0] });
  } catch (error) {
    console.error("Error marcando recogida:", error);
    return res.status(500).json({ error: "Error interno del servidor" });
  }
};

const obtenerDisponibilidadConductor = async (req, res) => {
  const conductorId = parsePositiveInt(req.params.id);

  if (!conductorId) {
    return res.status(400).json({ error: "ID de conductor inválido" });
  }

  try {
    const conductor = await getConductorActivo(conductorId);

    if (!conductor) {
      return res.status(404).json({ error: "Conductor no encontrado" });
    }

    const vehiculoId = await getVehiculoByUsuarioId(conductorId);

    if (!vehiculoId) {
      return res.status(404).json({ error: "No tienes vehículo activo asociado" });
    }

    const desde = req.query.desde || new Date().toISOString().slice(0, 10);
    const hasta = req.query.hasta || (() => {
      const date = new Date();
      date.setDate(date.getDate() + 30);
      return date.toISOString().slice(0, 10);
    })();

    const result = await pool.query(
      `SELECT
         s.fecha,
         CASE
           WHEN vd.disponible IS NOT NULL THEN vd.disponible
           WHEN EXTRACT(DOW FROM s.fecha)::INT = ANY(COALESCE(v.dias_servicio, ARRAY[0,1,2,3,4,5,6]))
                AND r.id IS NULL
           THEN true
           ELSE false
         END AS disponible,
         vd.nota
       FROM vehiculos v
       CROSS JOIN LATERAL generate_series($2::date, $3::date, interval '1 day') AS s(fecha)
       LEFT JOIN vehiculo_disponibilidad vd
         ON vd.vehiculo_id = v.id
        AND vd.fecha = s.fecha::date
       LEFT JOIN LATERAL (
         SELECT id
         FROM reservas
         WHERE vehiculo_id = v.id
           AND fecha_reserva = s.fecha::date
           AND estado NOT IN ('cancelada', 'finalizada')
         LIMIT 1
       ) r ON true
       WHERE v.id = $1
       ORDER BY s.fecha ASC`,
      [vehiculoId, desde, hasta]
    );

    return res.status(200).json({ vehiculo_id: vehiculoId, disponibilidad: result.rows });
  } catch (error) {
    console.error("Error consultando disponibilidad del conductor:", error);
    return res.status(500).json({ error: "Error interno del servidor" });
  }
};

const actualizarDisponibilidadConductor = async (req, res) => {
  const conductorId = parsePositiveInt(req.params.id);

  if (!conductorId) {
    return res.status(400).json({ error: "ID de conductor inválido" });
  }

  const payload = Array.isArray(req.body?.disponibilidad) ? req.body.disponibilidad : null;

  if (!payload || payload.length === 0) {
    return res.status(400).json({ error: "Debes enviar disponibilidad" });
  }

  try {
    const conductor = await getConductorActivo(conductorId);

    if (!conductor) {
      return res.status(404).json({ error: "Conductor no encontrado" });
    }

    const vehiculoId = await getVehiculoByUsuarioId(conductorId);

    if (!vehiculoId) {
      return res.status(404).json({ error: "No tienes vehículo activo asociado" });
    }

    for (const item of payload) {
      const fecha = String(item?.fecha || "").slice(0, 10);
      const disponible = typeof item?.disponible === "boolean" ? item.disponible : null;
      const nota = typeof item?.nota === "string" ? item.nota.trim().slice(0, 255) : null;

      if (!fecha || disponible === null) {
        return res.status(400).json({ error: "Cada item requiere fecha y disponible" });
      }

      await pool.query(
        `INSERT INTO vehiculo_disponibilidad (vehiculo_id, fecha, disponible, nota, actualizado_en)
         VALUES ($1, $2::date, $3, $4, CURRENT_TIMESTAMP)
         ON CONFLICT (vehiculo_id, fecha)
         DO UPDATE SET disponible = EXCLUDED.disponible, nota = EXCLUDED.nota, actualizado_en = CURRENT_TIMESTAMP`,
        [vehiculoId, fecha, disponible, nota]
      );
    }

    return res.status(200).json({ message: "Disponibilidad actualizada correctamente" });
  } catch (error) {
    console.error("Error actualizando disponibilidad del conductor:", error);
    return res.status(500).json({ error: "Error interno del servidor" });
  }
};

const actualizarEstadoConductor = async (req, res) => {
  const conductorId = parsePositiveInt(req.params.id);
  const estado = String(req.body.estado || "").trim().toLowerCase();

  if (!conductorId) {
    return res.status(400).json({ error: "ID de conductor inválido" });
  }

  const allowedStates = ["disponible", "en_servicio", "mantenimiento", "inactivo"];
  if (!allowedStates.includes(estado)) {
    return res.status(400).json({ error: "Estado inválido. Debe ser: disponible, en_servicio, mantenimiento o inactivo." });
  }

  try {
    const conductor = await getConductorActivo(conductorId);
    if (!conductor) {
      return res.status(404).json({ error: "Conductor no encontrado" });
    }

    // 1. Actualizar estado del conductor en la tabla conductores
    const conductorRecord = await pool.query(
      "SELECT id FROM conductores WHERE usuario_id = $1 LIMIT 1",
      [conductorId]
    );

    if (conductorRecord.rowCount > 0) {
      await pool.query(
        `UPDATE conductores
         SET estado = $1
         WHERE usuario_id = $2`,
        [estado, conductorId]
      );
    } else {
      await pool.query(
        `INSERT INTO conductores (usuario_id, licencia, estado)
         VALUES ($1, 'LIC-' || $1::text, $2)`,
        [conductorId, estado]
      );
    }

    // 2. Actualizar estado del vehículo activo asociado a ese conductor en la tabla vehiculos
    await pool.query(
      `UPDATE vehiculos
       SET estado = $1
       WHERE usuario_id = $2
         AND activo = true`,
      [estado, conductorId]
    );

    return res.status(200).json({
      success: true,
      message: "Estado general actualizado correctamente",
      estado: estado
    });
  } catch (error) {
    console.error("Error actualizando estado general del conductor:", error);
    return res.status(500).json({ error: "Error interno del servidor" });
  }
};

// ── Vehículo asignado del conductor ──────────────────────────────────────────
const obtenerMiVehiculoConductor = async (req, res) => {
  const conductorId = parsePositiveInt(req.params.id);
  if (!conductorId) {
    return res.status(400).json({ error: "ID de conductor inválido" });
  }
  try {
    const vehiculos = await getVehiculosCompletos(conductorId);
    if (!vehiculos.length) {
      return res.status(404).json({ error: "No tienes vehículo asignado" });
    }
    return res.status(200).json({ ...vehiculos[0], vehiculos });
  } catch (error) {
    console.error("Error obteniendo vehículo del conductor:", error);
    return res.status(500).json({ error: "Error interno del servidor" });
  }
};

// Calcula el estado del próximo servicio programado (por fecha y/o km) para
// un vehículo, comparándolo contra hoy y el kilometraje actual.
const calcularProximoServicio = (vehiculo) => {
  const { fecha_proximo_mantenimiento, proximo_km_mantenimiento, kilometraje } = vehiculo;
  if (!fecha_proximo_mantenimiento && !proximo_km_mantenimiento) return null;

  let diasRestantes = null;
  if (fecha_proximo_mantenimiento) {
    const hoy = new Date(new Date().toDateString());
    const objetivo = new Date(new Date(fecha_proximo_mantenimiento).toDateString());
    diasRestantes = Math.round((objetivo.getTime() - hoy.getTime()) / 86400000);
  }

  let kmRestantes = null;
  if (proximo_km_mantenimiento) {
    kmRestantes = proximo_km_mantenimiento - (Number(kilometraje) || 0);
  }

  const vencidoPorFecha = diasRestantes !== null && diasRestantes < 0;
  const vencidoPorKm = kmRestantes !== null && kmRestantes < 0;
  const urgentePorFecha = diasRestantes !== null && diasRestantes <= 7;
  const urgentePorKm = kmRestantes !== null && kmRestantes <= 500;

  let urgencia = "programado";
  if (vencidoPorFecha || vencidoPorKm) urgencia = "vencido";
  else if (urgentePorFecha || urgentePorKm) urgencia = "urgente";

  return {
    fecha_proximo_mantenimiento: fecha_proximo_mantenimiento || null,
    proximo_km_mantenimiento: proximo_km_mantenimiento || null,
    dias_restantes: diasRestantes,
    km_restantes: kmRestantes,
    urgencia,
  };
};

// ── Mantenimientos del vehículo asignado (listar) ─────────────────────────────
const listarMantenimientoConductor = async (req, res) => {
  const conductorId = parsePositiveInt(req.params.id);
  if (!conductorId) {
    return res.status(400).json({ error: "ID de conductor inválido" });
  }
  try {
    const vehiculo = await getVehiculoCompleto(conductorId);
    if (!vehiculo) {
      return res.status(200).json({ vehiculo: null, mantenimientos: [], proximo: null });
    }
    const result = await pool.query(
      `SELECT id, vehiculo_id, tipo, descripcion, fecha_programada, fecha_realizada,
              costo, estado, tecnico, observaciones, kilometraje, conductor_usuario_id, creado_en
       FROM mantenimiento_vehiculos
       WHERE vehiculo_id = $1
       ORDER BY COALESCE(fecha_realizada, fecha_programada) DESC, id DESC
       LIMIT 50`,
      [vehiculo.id]
    );
    return res.status(200).json({
      vehiculo,
      mantenimientos: result.rows,
      proximo: calcularProximoServicio(vehiculo),
    });
  } catch (error) {
    console.error("Error listando mantenimiento del conductor:", error);
    return res.status(500).json({ error: "Error interno del servidor" });
  }
};

// ── Registrar mantenimiento del vehículo asignado ─────────────────────────────
const crearMantenimientoConductor = async (req, res) => {
  const conductorId = parsePositiveInt(req.params.id);
  if (!conductorId) {
    return res.status(400).json({ error: "ID de conductor inválido" });
  }
  try {
    const vehiculo = await getVehiculoCompleto(conductorId);
    if (!vehiculo) {
      return res.status(400).json({ error: "No tienes vehículo asignado para registrar mantenimiento" });
    }

    const tipo = normalizeText(req.body.tipo, 50);
    const descripcion = normalizeText(req.body.descripcion, 2000);
    const fechaRealizada = normalizeText(req.body.fecha_realizada, 10) || new Date().toISOString().slice(0, 10);
    const costo = parseOptionalNumber(req.body.costo) ?? 0;
    const observaciones = normalizeText(req.body.observaciones, 2000);
    const kilometraje = parseOptionalNumber(req.body.kilometraje);
    const proximoKm = parseOptionalNumber(req.body.proximo_km);
    const proximaFecha = normalizeText(req.body.proxima_fecha, 10);

    if (!tipo) {
      return res.status(400).json({ error: "Debes indicar el tipo de mantenimiento" });
    }
    if (kilometraje === null || kilometraje < 0) {
      return res.status(400).json({ error: "Debes indicar el kilometraje actual del vehículo" });
    }
    if (vehiculo.kilometraje && kilometraje < Number(vehiculo.kilometraje)) {
      return res.status(400).json({ error: `El kilometraje no puede ser menor al último registrado (${Number(vehiculo.kilometraje).toLocaleString()} km)` });
    }

    const conductorInfo = await pool.query(`SELECT nombre FROM usuarios WHERE id = $1 LIMIT 1`, [conductorId]);
    const tecnico = conductorInfo.rows[0]?.nombre || "Conductor";

    const result = await pool.query(
      `INSERT INTO mantenimiento_vehiculos
         (vehiculo_id, tipo, descripcion, fecha_programada, fecha_realizada, costo, estado, tecnico, observaciones, kilometraje, conductor_usuario_id)
       VALUES ($1, $2, $3, $4::date, $4::date, $5, 'completado', $6, $7, $8, $9)
       RETURNING *`,
      [vehiculo.id, tipo, descripcion, fechaRealizada, costo, tecnico, observaciones, kilometraje, conductorId]
    );

    // Por defecto, registrar un mantenimiento CUMPLE el que estaba programado:
    // el aviso se reprograma a la nueva fecha/km, o se quita si no se pone otra.
    // Si el conductor marca que es un servicio EXTRA (cumple_programado=false),
    // no se toca el aviso programado.
    const cumpleProgramado = req.body.cumple_programado !== false;

    if (cumpleProgramado) {
      await pool.query(
        `UPDATE vehiculos SET
           kilometraje = GREATEST(COALESCE(kilometraje, 0), $1),
           fecha_proximo_mantenimiento = $2::date,
           proximo_km_mantenimiento = $3
         WHERE id = $4`,
        [kilometraje, proximaFecha || null, proximoKm, vehiculo.id]
      );
    } else {
      await pool.query(
        `UPDATE vehiculos SET
           kilometraje = GREATEST(COALESCE(kilometraje, 0), $1),
           fecha_proximo_mantenimiento = COALESCE($2::date, fecha_proximo_mantenimiento),
           proximo_km_mantenimiento = COALESCE($3, proximo_km_mantenimiento)
         WHERE id = $4`,
        [kilometraje, proximaFecha || null, proximoKm, vehiculo.id]
      );
    }

    return res.status(201).json({ message: "Mantenimiento registrado correctamente", data: result.rows[0] });
  } catch (error) {
    console.error("Error registrando mantenimiento del conductor:", error);
    return res.status(500).json({ error: "Error interno del servidor" });
  }
};

// ── Compartir ubicación en tiempo real ───────────────────────────────────────
const compartirUbicacionConductor = async (req, res) => {
  const conductorId = parsePositiveInt(req.params.id);
  const lat = parseOptionalNumber(req.body.lat);
  const lng = parseOptionalNumber(req.body.lng);

  if (!conductorId || lat === null || lng === null) {
    return res.status(400).json({ error: "Debes enviar lat y lng válidos" });
  }

  try {
    const vehiculo = await getVehiculoCompleto(conductorId);
    if (!vehiculo) {
      return res.status(400).json({ error: "No tienes vehículo asignado" });
    }
    await pool.query(
      `INSERT INTO vehiculo_ubicacion (vehiculo_id, conductor_usuario_id, lat, lng)
       VALUES ($1, $2, $3, $4)`,
      [vehiculo.id, conductorId, lat, lng]
    );
    return res.status(200).json({ message: "Ubicación actualizada" });
  } catch (error) {
    console.error("Error guardando ubicación del conductor:", error);
    return res.status(500).json({ error: "Error interno del servidor" });
  }
};

// ── Lista de clientes para que el conductor registre un viaje realizado ──────
const listarClientesConductor = async (req, res) => {
  const conductorId = parsePositiveInt(req.params.id);
  if (!conductorId) {
    return res.status(400).json({ error: "ID de conductor inválido" });
  }
  try {
    const result = await pool.query(
      `SELECT id, nombre, email, telefono
       FROM usuarios
       WHERE rol = 'cliente' AND activo = true
       ORDER BY nombre ASC`
    );
    return res.status(200).json(result.rows);
  } catch (error) {
    console.error("Error listando clientes para conductor:", error);
    return res.status(500).json({ error: "Error interno del servidor" });
  }
};

// ── Registrar un viaje ya realizado (acordado directamente con el cliente) ───
// Crea una reserva FINALIZADA ligada al cliente: aparece en el historial del
// conductor, en las reservas/facturas del admin y en el historial del cliente
// (quien además podrá calificarla).
const registrarViajeConductor = async (req, res) => {
  const conductorId = parsePositiveInt(req.params.id);
  const clienteId = parsePositiveInt(req.body.cliente_id);
  const numPersonas = parsePositiveInt(req.body.num_personas) || 1;
  const valorCobrado = parseOptionalNumber(req.body.valor_cobrado);
  const origen = normalizeText(req.body.origen, 300);
  const destino = normalizeText(req.body.destino, 300);
  const fechaViaje = normalizeText(req.body.fecha_viaje, 10) || new Date().toISOString().slice(0, 10);
  const notas = normalizeText(req.body.notas, 1000);

  if (!conductorId || !clienteId) {
    return res.status(400).json({ error: "Debes seleccionar el cliente" });
  }
  if (!origen || !destino) {
    return res.status(400).json({ error: "Debes marcar la salida y el destino" });
  }
  if (valorCobrado === null || valorCobrado <= 0) {
    return res.status(400).json({ error: "Debes indicar el valor cobrado" });
  }

  try {
    const conductor = await getConductorActivo(conductorId);
    if (!conductor) {
      return res.status(404).json({ error: "Conductor no encontrado" });
    }

    const cliente = await pool.query(
      `SELECT id, nombre FROM usuarios WHERE id = $1 AND rol = 'cliente' AND activo = true LIMIT 1`,
      [clienteId]
    );
    if (cliente.rowCount === 0) {
      return res.status(404).json({ error: "Cliente no encontrado" });
    }

    const conductorReservaId = await resolveReservaConductorId(conductorId);
    if (!conductorReservaId) {
      return res.status(400).json({ error: "Conductor no configurado para reservas" });
    }

    const vehiculo = await getVehiculoCompleto(conductorId);
    if (!vehiculo) {
      return res.status(400).json({ error: "No tienes vehículo asignado para registrar el viaje" });
    }

    const insert = await pool.query(
      `INSERT INTO reservas
         (usuario_id, conductor_id, vehiculo_id, fecha_reserva, num_personas, total, estado, origen, destino, notas)
       VALUES ($1, $2, $3, $4::date, $5, $6, 'finalizada', $7, $8, $9)
       RETURNING id, fecha_reserva, total`,
      [clienteId, conductorReservaId, vehiculo.id, fechaViaje, numPersonas, valorCobrado, origen, destino, notas]
    );
    const reserva = insert.rows[0];

    // Avisar al admin y al cliente (con enlace directo a la reserva)
    const conductorInfo = await pool.query(`SELECT nombre FROM usuarios WHERE id = $1 LIMIT 1`, [conductorId]);
    const nombreConductor = conductorInfo.rows[0]?.nombre || "Un conductor";
    const { notificarAdmins, crearNotificacion } = require("../config/notificaciones");
    await notificarAdmins(conductorId, `${nombreConductor} registró un viaje completado #${reserva.id}: ${origen} → ${destino} ($${Number(valorCobrado).toFixed(2)}).`, "reserva", reserva.id);
    await crearNotificacion(conductorId, clienteId, `Tu viaje #${reserva.id} fue registrado por el conductor. ¡Puedes calificarlo en tu historial!`, reserva.id, "reserva", reserva.id);

    return res.status(201).json({
      message: "Viaje registrado correctamente. Ya aparece en tu historial.",
      reserva,
    });
  } catch (error) {
    console.error("Error registrando viaje del conductor:", error);
    return res.status(500).json({ error: "Error interno del servidor" });
  }
};

module.exports = {
  listarReservasConductor,
  listarMisReservasConductor,
  aceptarReservaConductor,
  rechazarReservaConductor,
  actualizarEstadoReservaConductor,
  marcarRecogidoConductor,
  obtenerDisponibilidadConductor,
  actualizarDisponibilidadConductor,
  listarDisponibilidadExterna,
  crearDisponibilidadExterna,
  cancelarDisponibilidadExterna,
  crearReporteRutaConductor,
  listarReportesRutaConductor,
  actualizarEstadoConductor,
  obtenerMiVehiculoConductor,
  listarMantenimientoConductor,
  crearMantenimientoConductor,
  compartirUbicacionConductor,
  listarClientesConductor,
  registrarViajeConductor,
};
