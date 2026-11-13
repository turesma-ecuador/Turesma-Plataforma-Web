export {};

const pool = require("../../config/db");
const { crearNotificacion, notificarAdmins } = require("../../config/notificaciones");
const { getPricing, roadDistanceKm, calculateQuote } = require("../../config/pricing");

// PostgreSQL puede devolver columnas DATE como Date según la configuración del
// driver. Nunca se debe enviar Date.toString() a una columna DATE, porque
// produce valores como "Sun Nov 15" que PostgreSQL no puede interpretar.
const toDateOnly = (value: any, fallbackToday = false) => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  const text = String(value || "").trim();
  const isoDate = text.match(/^(\d{4}-\d{2}-\d{2})/);
  if (isoDate) return isoDate[1];

  return fallbackToday ? new Date().toISOString().slice(0, 10) : null;
};

// Crea la reserva pendiente de pago sin comprometer recursos. La asignación
// definitiva de vehículo y conductor se realiza en el flujo de Despacho.
const crearReservaDesdeCotizacion = async (client: any, c: any, precioFinal: number) => {
  const estadoInicial = Number(precioFinal) > 0 ? "pendiente_pago" : "confirmada";
  const fechaServicio = toDateOnly(c.fecha_servicio);
  const fechaFin = toDateOnly(c.fecha_fin);
  const fechaRegreso = toDateOnly(c.fecha_regreso);
  if (!fechaServicio) {
    throw new Error(`La cotización #${c.id} no tiene una fecha de servicio válida`);
  }
  const reservaRes = await client.query(
    `INSERT INTO reservas
       (usuario_id, fecha_reserva, fecha_fin, fecha_regreso, hora_regreso, fecha_salida, fecha_servicio, hora_salida,
        num_personas, total, estado, origen, destino, tipo_vehiculo, vehiculo_id, conductor_id)
     VALUES (
       $1, $2, $3, $4, $5,
       $2::date + COALESCE(NULLIF($6, '')::time, time '00:00'),
       $2::date + COALESCE(NULLIF($6, '')::time, time '00:00'),
       $6, $7, $8, $9, $10, $11, $12, NULL, NULL
     )
     RETURNING id`,
    [c.usuario_id, fechaServicio, fechaFin, fechaRegreso, c.hora_regreso || null, c.hora_salida || null, c.num_personas, precioFinal, estadoInicial, c.origen, c.destino, c.tipo_vehiculo || null]
  );
  return reservaRes.rows[0].id;
};

// ── Admin: listar todas las cotizaciones ────────────────────────────────────
const listarCotizaciones = async (req: any, res: any) => {
  try {
    const { estado } = req.query;
    const cond = estado && estado !== "todas"
      ? estado === "pendiente" ? `WHERE c.estado IN ('pendiente', 'negociacion')` : `WHERE c.estado = $1`
      : "";
    const params = estado && estado !== "todas" && estado !== "pendiente" ? [estado] : [];

    const result = await pool.query(
      `SELECT c.*,
              CASE WHEN c.estado = 'negociacion' THEN 'pendiente' ELSE c.estado END AS estado,
              u.nombre AS cliente_nombre,
              u.email  AS cliente_email,
              u.telefono AS cliente_telefono,
              v.placa AS vehiculo_placa,
              v.modelo AS vehiculo_modelo,
              v.tipo AS vehiculo_tipo_real,
              vc.id AS vehiculo_conductor_id,
              vu.nombre AS vehiculo_conductor_nombre
       FROM cotizaciones c
       JOIN usuarios u ON u.id = c.usuario_id
       LEFT JOIN vehiculos v ON v.id = c.vehiculo_id
       LEFT JOIN usuarios vu ON vu.id = v.usuario_id
       LEFT JOIN conductores vc ON vc.usuario_id = v.usuario_id
       ${cond}
       ORDER BY c.creado_en DESC`,
      params
    );
    return res.json(result.rows);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Error al listar cotizaciones" });
  }
};

// Cliente: crea una reserva pendiente de pago sin pasar por la bandeja de cotizaciones.
const crearReservaDirecta = async (req: any, res: any) => {
  const usuarioId = req.user?.id;
  const { origen, destino, fecha_servicio, fecha_fin, num_personas, vehiculo_id, tipo_vehiculo,
    origen_lat, origen_lng, destino_lat, destino_lng, num_viajes, modalidad_servicio, duracion_horas, hora_salida, notas } = req.body;
  if (!usuarioId || !origen || !destino || !fecha_servicio || !num_personas) {
    return res.status(400).json({ error: "Faltan datos para crear la reserva" });
  }

  const client = await pool.connect();
  try {
    const verified = await client.query("SELECT COALESCE(estado_verificacion, 'no_verificado') AS estado FROM usuarios WHERE id = $1", [usuarioId]);
    if (verified.rows[0]?.estado !== "verificado") {
      return res.status(403).json({ error: "Debes verificar tu identidad antes de reservar.", requiere_verificacion: true });
    }
    const vehicle = vehiculo_id ? await client.query("SELECT id, tipo FROM vehiculos WHERE id = $1 AND activo = true", [Number(vehiculo_id)]) : { rowCount: 0, rows: [] };
    if (vehiculo_id && vehicle.rowCount === 0) {
      return res.status(400).json({ error: "El vehículo seleccionado ya no está disponible" });
    }
    const tipoVehiculo = String(vehicle.rows[0]?.tipo || tipo_vehiculo || "van").trim().toLowerCase();
    if (!vehiculo_id) {
      const category = await client.query(
        `SELECT MAX(capacidad)::int AS capacidad
         FROM vehiculos
         WHERE activo = true AND LOWER(tipo) = LOWER($1)`,
        [tipoVehiculo]
      );
      if (category.rows[0]?.capacidad == null) {
        return res.status(400).json({ error: "La categoría seleccionada ya no está disponible" });
      }
      if (Number(num_personas) > Number(category.rows[0].capacidad)) {
        return res.status(400).json({ error: `La categoría seleccionada admite hasta ${category.rows[0].capacidad} pasajeros` });
      }
    }
    const fechaFin = typeof fecha_fin === "string" && /^\d{4}-\d{2}-\d{2}$/.test(fecha_fin) && fecha_fin > String(fecha_servicio) ? fecha_fin : null;
    const days = fechaFin ? Math.max(1, Math.round((new Date(fechaFin).getTime() - new Date(String(fecha_servicio).slice(0, 10)).getTime()) / 86400000) + 1) : 1;
    const trips = Math.max(1, Math.floor(Number(num_viajes) || 1));
    const coordinates = [origen_lat, origen_lng, destino_lat, destino_lng].every((value) => Number.isFinite(Number(value)));
    const distanceKm = coordinates ? await roadDistanceKm(Number(origen_lat), Number(origen_lng), Number(destino_lat), Number(destino_lng)) : 0;
    const pricing = await getPricing();
    const serviceMode = String(modalidad_servicio || (fechaFin ? "varios_dias" : "dia")).trim().toLowerCase();
    const hours = Math.max(1, Number(duracion_horas) || 1);
    const breakdown = calculateQuote({ pricing, distanceKm, days, trips, vehicleType: tipoVehiculo, serviceMode, hours });
    await client.query("BEGIN");
    const reservation = await client.query(
      `INSERT INTO reservas (usuario_id, fecha_reserva, fecha_fin, num_personas, total, estado, origen, destino, vehiculo_id, tipo_vehiculo, notas, monto_pagado, estado_pago, hora_salida)
       VALUES ($1, $2, $3, $4, $5, 'pendiente_pago', $6, $7, $8, $9, $10, 0, 'pendiente', $11) RETURNING id, total`,
      [usuarioId, fecha_servicio, fechaFin, Number(num_personas), breakdown.total, origen, destino, vehiculo_id ? Number(vehiculo_id) : null, tipoVehiculo, notas || null, hora_salida || null]
    );
    await client.query("COMMIT");
    const reservaId = Number(reservation.rows[0].id);
    await notificarAdmins(usuarioId, `Nueva reserva directa #${reservaId} pendiente de pago por $${Number(breakdown.total).toFixed(2)}.`, "reserva", reservaId);
    return res.status(201).json({ message: "Solicitud de reserva creada. Continúa con el pago; administración confirmará la reserva después de verificarlo.", reserva_id: reservaId, total: breakdown.total, pago_minimo: Number(breakdown.total) * 0.5 });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error creando reserva directa:", error);
    return res.status(500).json({ error: "No se pudo crear la reserva" });
  } finally { client.release(); }
};

// ── Admin: aprobar cotización y crear reserva ────────────────────────────────
const aprobarCotizacion = async (req: any, res: any) => {
  const { id } = req.params;
  const { precio_final, respuesta_admin } = req.body;

  const precio = Number(precio_final);
  if (!Number.isFinite(precio) || precio <= 0) {
    return res.status(400).json({ error: "Se requiere un precio_final mayor que cero para aprobar" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const cot = await client.query("SELECT * FROM cotizaciones WHERE id = $1 FOR UPDATE", [id]);
    if (cot.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Cotización no encontrada" });
    }
    if (!["pendiente", "negociacion"].includes(cot.rows[0].estado)) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "La cotización ya fue procesada" });
    }
    if (cot.rows[0].estado === "negociacion" && cot.rows[0].turno === "cliente") {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Espera la respuesta del cliente antes de aprobar la cotización" });
    }

    const c = cot.rows[0];
    const reservaId = await crearReservaDesdeCotizacion(client, c, precio);

    await client.query(
      `UPDATE cotizaciones
       SET estado = 'aprobada', precio_final = $1, respuesta_admin = $2,
           reserva_id = $3, vehiculo_id = NULL, turno = 'admin', actualizado_en = NOW()
       WHERE id = $4`,
      [precio, respuesta_admin || "Cotización aprobada", reservaId, id]
    );
    await client.query(
      `INSERT INTO cotizacion_negociacion (cotizacion_id, actor, precio, mensaje) VALUES ($1, 'admin', $2, $3)`,
      [id, precio, respuesta_admin || "Cotización aprobada"]
    );

    await client.query("COMMIT");

    // La reserva se asignará desde Despacho solo después de confirmar el pago.
    await crearNotificacion(req.user?.id, c.usuario_id, `Tu cotización fue aprobada por $${precio}. Reserva #${reservaId} creada: completa el pago para confirmarla y luego asignaremos el vehículo desde Despacho.`, reservaId, "reserva", reservaId);

    return res.json({ message: "Cotización aprobada y reserva creada sin asignación, pendiente de pago", reserva_id: reservaId });
  } catch (e) {
    await client.query("ROLLBACK");
    console.error(e);
    const message = e instanceof Error ? e.message : "Error al aprobar cotización";
    return res.status(500).json({ error: message });
  } finally {
    client.release();
  }
};

// ── Admin: contraofertar (proponer un precio distinto) ───────────────────────
const contraofertarCotizacion = async (req: any, res: any) => {
  const { id } = req.params;
  const { precio_propuesto, mensaje } = req.body;

  const precio = Number(precio_propuesto);
  if (!Number.isFinite(precio) || precio <= 0) {
    return res.status(400).json({ error: "Se requiere un precio_propuesto mayor que cero" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const cot = await client.query("SELECT estado, usuario_id, turno FROM cotizaciones WHERE id = $1 FOR UPDATE", [id]);
    if (cot.rowCount === 0) { await client.query("ROLLBACK"); return res.status(404).json({ error: "Cotización no encontrada" }); }
    if (!["pendiente", "negociacion"].includes(cot.rows[0].estado)) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "La cotización ya fue procesada" });
    }
    if (cot.rows[0].estado === "negociacion" && cot.rows[0].turno === "cliente") {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "El cliente debe responder la propuesta vigente antes de recibir otra" });
    }
    await client.query(
      `UPDATE cotizaciones
       SET estado = 'negociacion', precio_propuesto = $1, respuesta_admin = $2,
           turno = 'cliente', actualizado_en = NOW()
       WHERE id = $3`,
      [precio, mensaje || null, id]
    );
    await client.query(
      `INSERT INTO cotizacion_negociacion (cotizacion_id, actor, precio, mensaje) VALUES ($1, 'admin', $2, $3)`,
      [id, precio, mensaje || null]
    );
    await client.query("COMMIT");
    await crearNotificacion(req.user?.id, cot.rows[0].usuario_id, `El administrador te propone $${precio} por tu cotización #${id}. Revisa y responde.`, null, "cotizacion", Number(id));
    return res.json({ message: "Contraoferta enviada al cliente" });
  } catch (e) {
    await client.query("ROLLBACK");
    console.error(e);
    return res.status(500).json({ error: "Error al enviar contraoferta" });
  } finally {
    client.release();
  }
};

// ── Cliente: responder a una contraoferta (aceptar / contraofertar / rechazar) ─
const responderCotizacion = async (req: any, res: any) => {
  const { id } = req.params;
  const accion = String(req.body.accion || "").toLowerCase();
  const userId = req.user?.id;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const cot = await client.query("SELECT * FROM cotizaciones WHERE id = $1 FOR UPDATE", [id]);
    if (cot.rowCount === 0) { await client.query("ROLLBACK"); return res.status(404).json({ error: "Cotización no encontrada" }); }
    const c = cot.rows[0];
    if (Number(c.usuario_id) !== Number(userId)) { await client.query("ROLLBACK"); return res.status(403).json({ error: "No autorizado" }); }
    if (c.estado !== "negociacion" || c.turno !== "cliente") {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "No hay una propuesta pendiente por responder" });
    }

    if (accion === "aceptar") {
      const precioFinal = Number(c.precio_propuesto);
      const reservaId = await crearReservaDesdeCotizacion(client, c, precioFinal);
      await client.query(
        `UPDATE cotizaciones SET estado = 'aprobada', precio_final = $1, reserva_id = $2, vehiculo_id = NULL, turno = 'admin', actualizado_en = NOW() WHERE id = $3`,
        [precioFinal, reservaId, id]
      );
      await client.query(
        `INSERT INTO cotizacion_negociacion (cotizacion_id, actor, precio, mensaje) VALUES ($1, 'cliente', $2, 'Aceptó la propuesta')`,
        [id, precioFinal]
      );
      await client.query("COMMIT");
      await notificarAdmins(userId, `El cliente ACEPTÓ la propuesta de $${precioFinal} (cotización #${id}). Reserva #${reservaId} creada sin asignación, pendiente de pago.`, "reserva", reservaId);
      return res.json({ message: "¡Acuerdo alcanzado! Tu reserva fue creada, paga el total para confirmarla y luego será asignada desde Despacho.", reserva_id: reservaId });
    }

    if (accion === "contraoferta") {
      const nuevoValor = Number(req.body.valor);
      if (!Number.isFinite(nuevoValor) || nuevoValor <= 0) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "La contrapropuesta debe ser un valor mayor que cero" });
      }
      await client.query(
        `UPDATE cotizaciones SET estado = 'pendiente', valor_ofrecido = $1, turno = 'admin', actualizado_en = NOW() WHERE id = $2`,
        [nuevoValor, id]
      );
      await client.query(
        `INSERT INTO cotizacion_negociacion (cotizacion_id, actor, precio, mensaje) VALUES ($1, 'cliente', $2, $3)`,
        [id, nuevoValor, req.body.mensaje || null]
      );
      await client.query("COMMIT");
      await notificarAdmins(userId, `El cliente contraoferta $${nuevoValor} en la cotización #${id}.`, "cotizacion", Number(id));
      return res.json({ message: "Tu contrapropuesta fue enviada al administrador" });
    }

    if (accion === "rechazar") {
      await client.query(`UPDATE cotizaciones SET estado = 'rechazada', actualizado_en = NOW() WHERE id = $1`, [id]);
      await client.query(
        `INSERT INTO cotizacion_negociacion (cotizacion_id, actor, precio, mensaje) VALUES ($1, 'cliente', NULL, 'Canceló la negociación')`,
        [id]
      );
      await client.query("COMMIT");
      return res.json({ message: "Cotización cancelada" });
    }

    await client.query("ROLLBACK");
    return res.status(400).json({ error: "Acción inválida" });
  } catch (e) {
    await client.query("ROLLBACK");
    console.error(e);
    return res.status(500).json({ error: "Error al responder la cotización" });
  } finally {
    client.release();
  }
};

// ── Historial de negociación (admin u dueño) ─────────────────────────────────
const obtenerNegociacion = async (req: any, res: any) => {
  const { id } = req.params;
  try {
    const cot = await pool.query("SELECT usuario_id FROM cotizaciones WHERE id = $1", [id]);
    if (cot.rowCount === 0) return res.status(404).json({ error: "Cotización no encontrada" });
    const rol = String(req.user?.rol || "").toLowerCase();
    const esStaff = rol === "admin" || rol === "operativo";
    if (!esStaff && Number(cot.rows[0].usuario_id) !== Number(req.user?.id)) {
      return res.status(403).json({ error: "No autorizado" });
    }
    const hist = await pool.query(
      `SELECT actor, precio, mensaje, creado_en FROM cotizacion_negociacion WHERE cotizacion_id = $1 ORDER BY creado_en ASC`,
      [id]
    );
    return res.json(hist.rows);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Error al obtener la negociación" });
  }
};

// ── Admin: rechazar cotización ───────────────────────────────────────────────
const rechazarCotizacion = async (req: any, res: any) => {
  const { id } = req.params;
  const { respuesta_admin } = req.body;
  try {
    const result = await pool.query(
      `UPDATE cotizaciones
       SET estado = 'rechazada', respuesta_admin = $1, actualizado_en = NOW()
       WHERE id = $2 AND estado IN ('pendiente', 'negociacion')
       RETURNING id`,
      [respuesta_admin || "Cotización no disponible", id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Cotización no encontrada o ya procesada" });
    }
    await pool.query(
      `INSERT INTO cotizacion_negociacion (cotizacion_id, actor, precio, mensaje) VALUES ($1, 'admin', NULL, $2)`,
      [id, respuesta_admin || "Cotización no disponible"]
    );
    const dueno = await pool.query("SELECT usuario_id FROM cotizaciones WHERE id = $1", [id]);
    await crearNotificacion(req.user?.id, dueno.rows[0]?.usuario_id, `Tu cotización #${id} fue rechazada. ${respuesta_admin || ""}`.trim(), null, "cotizacion", Number(id));
    return res.json({ message: "Cotización rechazada" });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Error al rechazar cotización" });
  }
};

// ── Cliente: crear cotización ────────────────────────────────────────────────
const crearCotizacion = async (req: any, res: any) => {
  const usuario_id = req.user?.id || req.body.usuario_id;
  const {
    origen, destino, fecha_servicio, fecha_fin, num_personas, tipo_vehiculo, notas,
    vehiculo_id, valor_ofrecido, duracion_valor, duracion_unidad, hora_salida,
    fecha_regreso, hora_regreso,
    origen_lat, origen_lng, destino_lat, destino_lng,
    num_viajes, modalidad_servicio, duracion_horas,
  } = req.body;

  if (!usuario_id || !origen || !destino || !fecha_servicio || !num_personas) {
    return res.status(400).json({ error: "Faltan campos requeridos (origen, destino, fecha_servicio, num_personas)" });
  }

  const dUnidad = duracion_unidad === "dias" ? "dias" : "horas";
  const num = (v: any) => (v !== undefined && v !== null && v !== "" ? Number(v) : null);
  const horaSalida = typeof hora_salida === "string" && hora_salida.trim() ? hora_salida.trim().slice(0, 10) : null;
  // Reserva de varios días: la fecha fin solo se guarda si es una fecha válida
  // POSTERIOR a la de inicio; si no, es un servicio de un solo día (null).
  const esFecha = (v: any) => {
    if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v.trim())) return false;
    const value = v.trim();
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  };
  const fechaFin = esFecha(fecha_fin) && fecha_fin.trim() > String(fecha_servicio).trim() ? fecha_fin.trim() : null;
  const fechaRegreso = fecha_regreso == null || fecha_regreso === "" ? null : esFecha(fecha_regreso) ? fecha_regreso.trim() : null;
  const horaRegreso = typeof hora_regreso === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(hora_regreso.trim()) ? hora_regreso.trim() : null;
  if (fecha_regreso && (!fechaRegreso || fechaRegreso <= String(fecha_servicio).trim())) {
    return res.status(400).json({ error: "La fecha de regreso debe ser posterior a la fecha de salida" });
  }
  if (fechaRegreso && !horaRegreso) {
    return res.status(400).json({ error: "Indica una hora válida para la recogida de regreso" });
  }
  if (!fechaRegreso && hora_regreso) {
    return res.status(400).json({ error: "La hora de regreso requiere una fecha de regreso" });
  }
  if (fechaRegreso && fechaFin) {
    return res.status(400).json({ error: "El regreso en otra fecha no se combina con un servicio de varios días" });
  }
  try {
    // Candado de identidad: un cliente solo puede solicitar servicios si su
    // cédula fue verificada por el administrador. El staff (admin/operativo)
    // que crea cotizaciones a nombre de un cliente no pasa por este candado.
    const rol = String(req.user?.rol || "").toLowerCase();
    if (rol === "cliente") {
      const v = await pool.query("SELECT COALESCE(estado_verificacion, 'no_verificado') AS estado FROM usuarios WHERE id = $1", [usuario_id]);
      if ((v.rows[0]?.estado || "no_verificado") !== "verificado") {
        return res.status(403).json({
          error: "Debes verificar tu identidad (cédula) antes de solicitar un servicio.",
          requiere_verificacion: true,
        });
      }
    }

    const trips = Math.max(1, Math.floor(Number(num_viajes) || 1));
    let tipoVehiculo = String(tipo_vehiculo || "").trim().toLowerCase() || null;
    if (vehiculo_id) {
      const vehicleResult = await pool.query("SELECT tipo FROM vehiculos WHERE id = $1", [Number(vehiculo_id)]);
      if (vehicleResult.rows[0]?.tipo) tipoVehiculo = String(vehicleResult.rows[0].tipo).trim().toLowerCase();
    }
    const result = await pool.query(
      `INSERT INTO cotizaciones
         (usuario_id, origen, destino, fecha_servicio, fecha_fin, num_personas, tipo_vehiculo, notas,
          vehiculo_id, valor_ofrecido, precio_estimado, num_viajes, distancia_km, precio_desglose,
          duracion_valor, duracion_unidad, turno,
           origen_lat, origen_lng, destino_lat, destino_lng, hora_salida, fecha_regreso, hora_regreso)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, 'admin', $17, $18, $19, $20, $21, $22, $23)
       RETURNING *`,
      [
        usuario_id, origen, destino, fecha_servicio, fechaFin, num_personas, tipoVehiculo, notas || null,
        vehiculo_id ? Number(vehiculo_id) : null, num(valor_ofrecido), null, trips, null, null,
         num(duracion_valor), dUnidad, num(origen_lat), num(origen_lng), num(destino_lat), num(destino_lng), horaSalida, fechaRegreso, horaRegreso,
      ]
    );
    const cotizacion = result.rows[0];
    if (cotizacion.valor_ofrecido) {
      await pool.query(
        `INSERT INTO cotizacion_negociacion (cotizacion_id, actor, precio, mensaje) VALUES ($1, 'cliente', $2, 'Solicitud inicial')`,
        [cotizacion.id, cotizacion.valor_ofrecido]
      );
    }
    await notificarAdmins(usuario_id, `Nueva cotización #${cotizacion.id}: ${origen} → ${destino} (${num_personas} pax).`, "cotizacion", cotizacion.id);
    return res.status(201).json(cotizacion);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Error al crear cotización" });
  }
};

// ── Cliente: listar mis cotizaciones ────────────────────────────────────────
const listarMisCotizaciones = async (req: any, res: any) => {
  const rol = String(req.user?.rol || "").toLowerCase();
  const esStaff = rol === "admin" || rol === "operativo";
  const usuario_id = esStaff && req.params.usuario_id ? req.params.usuario_id : req.user?.id;

  if (!usuario_id) return res.status(401).json({ error: "No autenticado" });

  try {
    const result = await pool.query(
      `SELECT c.*,
              r.estado AS reserva_estado,
              v.placa AS vehiculo_placa,
              v.modelo AS vehiculo_modelo
       FROM cotizaciones c
       LEFT JOIN reservas r ON r.id = c.reserva_id
       LEFT JOIN vehiculos v ON v.id = c.vehiculo_id
       WHERE c.usuario_id = $1
       ORDER BY c.creado_en DESC`,
      [usuario_id]
    );
    return res.json(result.rows);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Error al listar cotizaciones" });
  }
};

// ── Admin: resumen de cotizaciones (KPIs) ────────────────────────────────────
const resumenCotizaciones = async (_req: any, res: any) => {
  try {
    const result = await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE estado IN ('pendiente', 'negociacion')) AS pendientes,
         COUNT(*) FILTER (WHERE estado = 'aprobada')    AS aprobadas,
         COUNT(*) FILTER (WHERE estado = 'rechazada')   AS rechazadas,
         COUNT(*) AS total,
         COALESCE(SUM(precio_final) FILTER (WHERE estado = 'aprobada'), 0) AS ingresos_generados
       FROM cotizaciones`
    );
    return res.json(result.rows[0]);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Error al obtener resumen" });
  }
};

module.exports = {
  listarCotizaciones,
  aprobarCotizacion,
  contraofertarCotizacion,
  responderCotizacion,
  obtenerNegociacion,
  rechazarCotizacion,
  crearCotizacion,
  listarMisCotizaciones,
  resumenCotizaciones,
  crearReservaDirecta,
};
