export {};

const pool = require("../config/db");
const { crearNotificacion, notificarAdmins } = require("../config/notificaciones");
const { buildProformaDataRequerimiento, generarProformaPDF } = require("../config/proforma");
const { prepararDespachoRequerimiento } = require("../config/requerimientosDespacho");
const { notificarPropuestaRequerimiento } = require("../config/requerimientoMailer");

const optionalText = (value: unknown, maxLength: number): string | null | undefined => {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  if (text.length > maxLength) return undefined;
  return text || null;
};

const validDate = (value: unknown): string | null | undefined => {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? value
    : undefined;
};

const normalizeServiceGroups = (value: unknown) => {
  if (!Array.isArray(value) || value.length < 1 || value.length > 20) return null;
  const groups = [];
  for (const rawGroup of value) {
    if (!rawGroup || typeof rawGroup !== "object" || Array.isArray(rawGroup)) return null;
    const group = rawGroup as Record<string, unknown>;
    const count = Number(group.cantidad_vehiculos);
    const passengers = group.pasajeros_por_vehiculo === "" || group.pasajeros_por_vehiculo == null
      ? null
      : Number(group.pasajeros_por_vehiculo);
    const startDate = validDate(group.fecha_servicio);
    const endDate = validDate(group.fecha_fin);
    const departureTime = optionalText(group.hora_salida, 10);
    const origin = optionalText(group.origen, 300);
    const destination = optionalText(group.destino, 300);
    const vehicleType = optionalText(group.tipo_vehiculo, 100);
    const stops = optionalText(group.paradas, 1000);
    const details = optionalText(group.detalles, 2000);

    if (!Number.isInteger(count) || count < 1 || count > 1000) return null;
    if (passengers !== null && (!Number.isInteger(passengers) || passengers < 1 || passengers > 1000)) return null;
    if ([startDate, endDate].includes(undefined) || [departureTime, origin, destination, vehicleType, stops, details].includes(undefined)) return null;
    if (endDate && (!startDate || endDate < startDate)) return null;
    if (departureTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(departureTime)) return null;
    if (typeof group.simultaneo !== "boolean") return null;

    groups.push({
      cantidad_vehiculos: count,
      tipo_vehiculo: vehicleType,
      pasajeros_por_vehiculo: passengers,
      fecha_servicio: startDate,
      fecha_fin: endDate,
      hora_salida: departureTime,
      origen: origin,
      destino: destination,
      paradas: stops,
      detalles: details,
      simultaneo: group.simultaneo,
    });
  }
  if (groups.reduce((total, group) => total + group.cantidad_vehiculos, 0) > 1000) return null;
  return groups;
};

const crearRequerimiento = async (req: any, res: any) => {
  const usuarioId = Number(req.user?.id);
  const body = req.body || {};
  const detalles = typeof body.detalles === "string" ? body.detalles.trim() : "";
  const organizacion = optionalText(body.organizacion, 200);
  const serviceGroups = normalizeServiceGroups(body.grupos_servicio);

  if (!Number.isInteger(usuarioId) || usuarioId <= 0) {
    return res.status(401).json({ error: "No se pudo identificar al cliente" });
  }
  if (organizacion === undefined) {
    return res.status(400).json({ error: "Revisa los textos: uno de los campos supera la longitud permitida o no es válido" });
  }
  if (!serviceGroups) return res.status(400).json({ error: "Revisa los grupos de servicio y asegúrate de completar sus datos correctamente" });
  if (detalles.length < 10 || detalles.length > 5000) {
    return res.status(400).json({ error: "Describe el requerimiento con al menos 10 caracteres y máximo 5000" });
  }
  const totalVehiculos = serviceGroups.reduce((total, group) => total + group.cantidad_vehiculos, 0);
  const firstGroup = serviceGroups[0];
  const distinctTypes = Array.from(new Set(serviceGroups.map(group => group.tipo_vehiculo).filter(Boolean)));
  const legacyVehicleType = distinctTypes.length === 1 ? distinctTypes[0] : distinctTypes.length > 1 ? "Varios" : null;

  try {
    const result = await pool.query(
      `INSERT INTO requerimientos_personalizados
         (usuario_id, organizacion, cantidad_vehiculos, tipo_vehiculo, pasajeros_por_vehiculo,
          fecha_servicio, fecha_fin, hora_salida, origen, destino, detalles, service_groups)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING id, estado, creado_en`,
      [
        usuarioId,
        organizacion,
        totalVehiculos,
        legacyVehicleType,
        serviceGroups.length === 1 ? firstGroup.pasajeros_por_vehiculo : null,
        firstGroup.fecha_servicio,
        firstGroup.fecha_fin,
        firstGroup.hora_salida,
        firstGroup.origen,
        firstGroup.destino,
        detalles,
        JSON.stringify(serviceGroups),
      ]
    );
    const requerimiento = result.rows[0];
    await notificarAdmins(usuarioId, `Nuevo requerimiento personalizado #${requerimiento.id}`, "requerimiento", requerimiento.id);
    return res.status(201).json(requerimiento);
  } catch (error) {
    console.error("Error creando requerimiento personalizado:", error);
    return res.status(500).json({ error: "No se pudo enviar el requerimiento. Intenta nuevamente." });
  }
};

const listarMisRequerimientos = async (req: any, res: any) => {
  const usuarioId = Number(req.user?.id);
  if (!Number.isInteger(usuarioId) || usuarioId <= 0) {
    return res.status(401).json({ error: "No se pudo identificar al cliente" });
  }
  try {
    const result = await pool.query(
      `SELECT r.id, r.organizacion, r.cantidad_vehiculos, r.tipo_vehiculo, r.pasajeros_por_vehiculo, r.service_groups,
              r.fecha_servicio, r.fecha_fin, r.hora_salida, r.origen, r.destino, r.detalles, r.estado,
              r.precio_final, r.reserva_id, r.respuesta_admin, r.estado_despacho,
              r.aceptado_en,
              b.estado_pago AS reserva_estado_pago,
              COALESCE((
                SELECT json_agg(json_build_object(
                  'grupo_numero', o.grupo_numero,
                  'unidad_numero', o.unidad_numero,
                  'estado', o.estado,
                  'fecha_programada', o.fecha_programada,
                  'fecha_fin_programada', o.fecha_fin_programada,
                  'vehiculo_placa', v.placa
                ) ORDER BY o.grupo_numero, o.unidad_numero)
                FROM operaciones o
                LEFT JOIN vehiculos v ON v.id = o.vehiculo_id
                WHERE o.requerimiento_id = r.id
              ), '[]'::json) AS unidades_despacho,
              r.creado_en, r.actualizado_en
       FROM requerimientos_personalizados r
       LEFT JOIN reservas b ON b.id = r.reserva_id
       WHERE r.usuario_id = $1
       ORDER BY r.creado_en DESC
       LIMIT 100`,
      [usuarioId]
    );
    return res.json(result.rows);
  } catch (error) {
    console.error("Error listando requerimientos personalizados del cliente:", error);
    return res.status(500).json({ error: "No se pudieron cargar tus requerimientos" });
  }
};

const listarRequerimientosAdmin = async (_req: any, res: any) => {
  try {
    const result = await pool.query(
      `SELECT r.*, u.nombre AS cliente_nombre, u.email AS cliente_email, u.telefono AS cliente_telefono
       FROM requerimientos_personalizados r
       JOIN usuarios u ON u.id = r.usuario_id
       ORDER BY CASE WHEN r.estado IN ('pendiente', 'en_revision') THEN 0 ELSE 1 END,
                r.creado_en DESC
       LIMIT 300`
    );
    return res.json(result.rows);
  } catch (error) {
    console.error("Error listando requerimientos personalizados para administración:", error);
    return res.status(500).json({ error: "No se pudieron cargar los requerimientos personalizados" });
  }
};

const actualizarRequerimientoAdmin = async (req: any, res: any) => {
  const id = Number(req.params.id);
  const usuarioAdminId = Number(req.user?.id);
  const estado = String(req.body?.estado || "").trim();
  const respuesta = String(req.body?.respuesta_admin || "").trim();
  const estadosValidos = ["pendiente", "en_revision", "respondido", "propuesta_enviada", "cerrado", "rechazado"];

  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "Requerimiento inválido" });
  if (!estadosValidos.includes(estado)) return res.status(400).json({ error: "Selecciona un estado válido" });
  if (respuesta.length > 5000) return res.status(400).json({ error: "La respuesta no puede superar 5000 caracteres" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const currentResult = await client.query(
      "SELECT * FROM requerimientos_personalizados WHERE id = $1 FOR UPDATE",
      [id]
    );
    if (!currentResult.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "No se encontró el requerimiento" });
    }
    const current = currentResult.rows[0];
    if (current.reserva_id) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "La propuesta ya fue aceptada y no puede modificarse" });
    }

    const groups = Array.isArray(current.service_groups) ? current.service_groups : [];
    let updatedGroups = groups;
    if (req.body?.grupos_servicio !== undefined) {
      const normalizedGroups = normalizeServiceGroups(req.body.grupos_servicio);
      if (!normalizedGroups || normalizedGroups.length !== groups.length) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "Los grupos del servicio no son válidos o no coinciden con la solicitud original" });
      }
      updatedGroups = normalizedGroups.map((group: Record<string, unknown>, index: number) => ({
        ...group,
        ...(groups[index].precio_total === undefined ? {} : { precio_total: groups[index].precio_total }),
      }));
    }
    let price: number | null = current.precio_final == null ? null : Number(current.precio_final);
    if (req.body?.precios_grupo !== undefined) {
      const prices: unknown[] = req.body.precios_grupo;
      if (!Array.isArray(prices) || prices.length !== updatedGroups.length) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "Asigna un precio válido a cada grupo de servicio" });
      }
      const parsedPrices = prices.map(value => typeof value === "string" && value.trim() === "" ? NaN : Number(value));
      if (parsedPrices.some(value => !Number.isFinite(value) || value <= 0 || value > 100000000)) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "Cada grupo debe tener un precio mayor a cero" });
      }
      const sum = parsedPrices.reduce((total, value) => total + Math.round(value * 100) / 100, 0);
      if (sum > 100000000) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "El total de la propuesta supera el límite permitido" });
      }
      updatedGroups = updatedGroups.map((group: Record<string, unknown>, index: number) => ({
        ...group,
        precio_total: Math.round(parsedPrices[index] * 100) / 100,
      }));
      price = Math.round(sum * 100) / 100;
    }
    if (estado === "propuesta_enviada") {
      if (price === null || !updatedGroups.length || updatedGroups.some((group: Record<string, unknown>) => {
        const startDate = validDate(group.fecha_servicio);
        const endDate = validDate(group.fecha_fin);
        return Number(group.precio_total) <= 0
          || !Number.isInteger(Number(group.cantidad_vehiculos)) || Number(group.cantidad_vehiculos) < 1
          || !Number.isInteger(Number(group.pasajeros_por_vehiculo)) || Number(group.pasajeros_por_vehiculo) < 1
          || !startDate || !optionalText(group.origen, 300) || !optionalText(group.destino, 300)
          || endDate === undefined || Boolean(endDate && startDate && endDate < startDate);
      })) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "Completa un precio y los datos de ruta, fecha y pasajeros de cada grupo antes de enviar la propuesta" });
      }
    }
    const result = await client.query(
      `UPDATE requerimientos_personalizados
       SET estado = $1, precio_final = $2, service_groups = $3::jsonb,
           respuesta_admin = $4, respondido_por = $5, actualizado_en = NOW()
       WHERE id = $6
       RETURNING id, usuario_id, estado, precio_final, service_groups, respuesta_admin, actualizado_en`,
      [
        estado,
        price,
        JSON.stringify(updatedGroups),
        respuesta || null,
        Number.isInteger(usuarioAdminId) ? usuarioAdminId : null,
        id,
      ]
    );
    await client.query("COMMIT");
    const updated = result.rows[0];
    const isProposal = estado === "propuesta_enviada";
    await crearNotificacion(
      usuarioAdminId,
      Number(updated.usuario_id),
      isProposal
        ? `Turesma envió una propuesta para tu requerimiento #${id}. Total: $${Number(updated.precio_final).toFixed(2)}. Revisa los precios por grupo y responde en Mis requerimientos.`
        : `Turesma actualizó tu requerimiento personalizado #${id}: ${estado.replace("_", " ")}`,
      null,
      "requerimiento",
      Number(updated.id)
    );
    if (isProposal) await notificarPropuestaRequerimiento(updated);
    return res.json(updated);
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error actualizando requerimiento personalizado:", error);
    return res.status(500).json({ error: "No se pudo guardar la respuesta. Intenta nuevamente." });
  } finally {
    client.release();
  }
};

const aceptarPropuestaRequerimiento = async (req: any, res: any) => {
  const requerimientoId = Number(req.params.id);
  const usuarioId = Number(req.user?.id);
  if (!Number.isInteger(requerimientoId) || requerimientoId <= 0) {
    return res.status(400).json({ error: "Requerimiento inválido" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `SELECT * FROM requerimientos_personalizados
       WHERE id = $1 AND usuario_id = $2
       FOR UPDATE`,
      [requerimientoId, usuarioId]
    );
    if (!result.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "No se encontró el requerimiento" });
    }
    const request = result.rows[0];
    if (request.reserva_id) {
      await client.query("COMMIT");
      return res.json({ reserva_id: Number(request.reserva_id), message: "La propuesta ya fue aceptada." });
    }
    if (request.estado !== "propuesta_enviada") {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "No hay una propuesta disponible para aceptar" });
    }
    const precio = Number(request.precio_final);
    if (!Number.isFinite(precio) || precio <= 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "La propuesta todavía no tiene un precio válido" });
    }
    const groups = Array.isArray(request.service_groups) ? request.service_groups : [];
    if (!groups.length || groups.some((group: Record<string, unknown>) =>
      !Number.isFinite(Number(group.precio_total)) || Number(group.precio_total) <= 0
    )) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "La propuesta no contiene precios válidos para todos los grupos" });
    }
    const fechaServicio = groups.map((group: Record<string, unknown>) => validDate(group.fecha_servicio))
      .filter(Boolean).sort()[0] || new Date().toISOString().slice(0, 10);
    const fechaFin = groups.map((group: Record<string, unknown>) => validDate(group.fecha_fin) || validDate(group.fecha_servicio))
      .filter(Boolean).sort().at(-1) || fechaServicio;
    const pasajerosTotal = groups.reduce((total: number, group: Record<string, unknown>) =>
      total + Number(group.cantidad_vehiculos || 0) * Number(group.pasajeros_por_vehiculo || 1), 0);
    const firstGroup = groups[0];
    const firstGroupDate = validDate(firstGroup.fecha_servicio) || fechaServicio;
    const salida = firstGroup.hora_salida ? `${firstGroupDate} ${firstGroup.hora_salida}` : null;
    const groupPriceTotal = groups.reduce((sum: number, group: Record<string, unknown>) =>
      sum + Math.round(Number(group.precio_total) * 100), 0);
    if (Math.abs(groupPriceTotal - Math.round(precio * 100)) > 1) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "El total de la propuesta no coincide con los subtotales" });
    }
    const notas = [
      `Requerimiento personalizado #${requerimientoId}`,
      request.detalles,
      "Pago único por el requerimiento completo. Las unidades se prepararán individualmente en Despacho tras confirmar el pago.",
    ].filter(Boolean).join("\n\n");
    const reservation = await client.query(
      `INSERT INTO reservas
         (usuario_id, fecha_reserva, fecha_fin, fecha_regreso, num_personas, total, estado,
          origen, destino, tipo_vehiculo, notas, monto_pagado, estado_pago, fecha_servicio, fecha_salida)
       VALUES ($1, $2, $3, $3, $4, $5, 'pendiente_pago', $6, $7, 'Varios', $8, 0, 'pendiente', $2, $9::timestamp)
       RETURNING id`,
      [
        usuarioId,
        fechaServicio,
        fechaFin,
        pasajerosTotal,
        precio,
        "Ver grupos de servicio",
        "Ver grupos de servicio",
        notas,
        salida,
      ]
    );
    const reservaId = Number(reservation.rows[0].id);
    await client.query(
      `UPDATE requerimientos_personalizados
       SET reserva_id = $1, estado = 'pago_pendiente',
           estado_despacho = 'pendiente', error_despacho = NULL,
           aceptado_en = COALESCE(aceptado_en, NOW()), actualizado_en = NOW()
       WHERE id = $2`,
      [reservaId, requerimientoId]
    );
    await client.query("COMMIT");
    await notificarAdmins(usuarioId, `El cliente aceptó la propuesta del requerimiento personalizado #${requerimientoId}. Reserva #${reservaId} pendiente de pago.`, "reserva", reservaId);
    return res.status(201).json({
      message: "Propuesta aceptada. Continúa con el pago del servicio completo.",
      reserva_id: reservaId,
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error preparando pago del requerimiento personalizado:", error);
    return res.status(500).json({ error: "No se pudo preparar el pago. Intenta nuevamente." });
  } finally {
    client.release();
  }
};

const descargarProformaRequerimiento = async (req: any, res: any) => {
  const id = Number(req.params.id);
  const usuarioId = Number(req.user?.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "Requerimiento inválido" });
  try {
    const data = await buildProformaDataRequerimiento(id, usuarioId);
    if (!data) return res.status(404).json({ error: "No se encontró una propuesta para este requerimiento" });
    const pdf = await generarProformaPDF(data);
    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="proforma_requerimiento_${id}.pdf"`,
      "Content-Length": String(pdf.length),
    });
    return res.send(pdf);
  } catch (error) {
    console.error("Error generando proforma del requerimiento:", error);
    return res.status(500).json({ error: "No se pudo generar la proforma" });
  }
};

const descargarProformaRequerimientoAdmin = async (req: any, res: any) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "Requerimiento inválido" });
  try {
    const data = await buildProformaDataRequerimiento(id);
    if (!data) return res.status(404).json({ error: "No se encontró una propuesta para este requerimiento" });
    const pdf = await generarProformaPDF(data);
    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="proforma_requerimiento_${id}.pdf"`,
      "Content-Length": String(pdf.length),
    });
    return res.send(pdf);
  } catch (error) {
    console.error("Error generando proforma del requerimiento para administración:", error);
    return res.status(500).json({ error: "No se pudo generar la proforma" });
  }
};

const reintentarDespachoRequerimiento = async (req: any, res: any) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "Requerimiento inválido" });
  try {
    const result = await pool.query(
      "SELECT reserva_id FROM requerimientos_personalizados WHERE id = $1",
      [id]
    );
    if (!result.rowCount || !result.rows[0].reserva_id) {
      return res.status(409).json({ error: "El requerimiento todavía no tiene una reserva pagada" });
    }
    const dispatch = await prepararDespachoRequerimiento(Number(result.rows[0].reserva_id), Number(req.user?.id));
    return res.json(dispatch);
  } catch (error) {
    console.error(`Error preparando despacho del requerimiento #${id}:`, error);
    return res.status(500).json({ error: "No se pudo generar el despacho. Revisa los datos de servicio y vuelve a intentar." });
  }
};

module.exports = {
  crearRequerimiento,
  listarMisRequerimientos,
  listarRequerimientosAdmin,
  actualizarRequerimientoAdmin,
  aceptarPropuestaRequerimiento,
  pagarRequerimiento: aceptarPropuestaRequerimiento,
  descargarProformaRequerimiento,
  descargarProformaRequerimientoAdmin,
  reintentarDespachoRequerimiento,
};
