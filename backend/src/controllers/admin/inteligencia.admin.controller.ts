export {};

const pool = require("../../config/db");

const safeCount = async (sql, params = []) => {
  const result = await pool.query(sql, params);
  return Number(result.rows[0]?.total || 0);
};

// Base para calcular la matriculación de cada vehículo por el último dígito de
// su placa (el mes lo define el calendario editable matricula_calendario).
const CTE_MATRICULA = `
  WITH veh AS (
    SELECT v.placa, v.fecha_matricula,
      (SELECT mc.mes FROM matricula_calendario mc
       WHERE mc.digito = RIGHT(regexp_replace(v.placa, '[^0-9]', '', 'g'), 1)::int) AS mes
    FROM vehiculos v
    WHERE v.placa IS NOT NULL AND v.placa ~ '[0-9]'
  )
`;
// Un vehículo está "matriculado este año" si su última matrícula es de este año.
const MAT_HECHO = "(fecha_matricula IS NOT NULL AND EXTRACT(YEAR FROM fecha_matricula) >= EXTRACT(YEAR FROM CURRENT_DATE))";
// Inicio y fin del mes que le toca según el calendario, en el año actual.
const MAT_INICIO = "make_date(EXTRACT(YEAR FROM CURRENT_DATE)::int, mes, 1)";
const MAT_FIN = "(make_date(EXTRACT(YEAR FROM CURRENT_DATE)::int, mes, 1) + INTERVAL '1 month' - INTERVAL '1 day')::date";

// A qué pantalla del admin lo manda cada tipo de alerta, para poder resolverla
// con un clic en vez de solo informarla.
const LINK_POR_TIPO = {
  mantenimiento: "/admin/mantenimiento",
  cumplimiento: "/admin/cumplimiento",
  licencias: "/admin/conductores",
  conductores: "/admin/conductores",
  rutas: "/admin/rutas-analisis",
  pagos: "/admin/pagos",
  asignacion: "/admin/vehiculos",
  flujo: "/admin/reservas",
  flota: "/admin/vehiculos",
};

const buildDashboardData = async () => {
  // ============ MÉTRICAS BASE ============
  const [
    totalUsuarios,
    totalClientes,
    totalConductores,
    totalVehiculos,
    vehiculosActivos,
    vehiculosSinAsignar,
    reservasPendientes,
    reservasPendientePago,
    reservasConfirmadas,
    reservasEnCurso,
    reservasFinalizadas,
    // MANTENIMIENTO (basado en vehiculos.fecha_proximo_mantenimiento / proximo_km_mantenimiento,
    // que es lo que el conductor programa al registrar un servicio — no el estado
    // 'programado' legado, que ya nadie crea)
    mantenimientoVencido,
    mantenimientoPendiente,
    mantenimientoCompletado,
    costomantenimientoMes,
    // CUMPLIMIENTO
    cumplimientoVencido,
    cumplimientoCritico,
    cumplimientoVigente,
    // DESEMPEÑO (conductores.estado real: 'disponible' | 'en_servicio' | 'inactivo')
    conductoresActivos,
    conductoresInactivos,
    ratingPromedioConductores,
    licenciasVencidas,
    // RUTAS (calculado en vivo desde reservas, igual que la página Análisis de Rutas;
    // la tabla rutas_analisis está vacía y no se usa en ningún flujo real)
    rutasActivas,
    tasaCancelacionRutas,
  ] = await Promise.all([
    safeCount("SELECT COUNT(*)::int AS total FROM usuarios"),
    safeCount("SELECT COUNT(*)::int AS total FROM usuarios WHERE LOWER(rol) = 'cliente'"),
    safeCount("SELECT COUNT(*)::int AS total FROM conductores"),
    safeCount("SELECT COUNT(*)::int AS total FROM vehiculos"),
    safeCount("SELECT COUNT(*)::int AS total FROM vehiculos WHERE activo = true"),
    safeCount("SELECT COUNT(*)::int AS total FROM vehiculos WHERE usuario_id IS NULL"),
    safeCount("SELECT COUNT(*)::int AS total FROM reservas WHERE LOWER(estado) = 'pendiente'"),
    safeCount("SELECT COUNT(*)::int AS total FROM reservas WHERE LOWER(estado) = 'pendiente_pago'"),
    safeCount("SELECT COUNT(*)::int AS total FROM reservas WHERE LOWER(estado) = 'confirmada'"),
    safeCount("SELECT COUNT(*)::int AS total FROM reservas WHERE LOWER(estado) = 'en_curso'"),
    safeCount("SELECT COUNT(*)::int AS total FROM reservas WHERE LOWER(estado) = 'finalizada'"),
    // MANTENIMIENTO
    // COALESCE(cond, false) en cada condición atómica evita que "NULL OR FALSE"
    // colapse a NULL (que en un WHERE excluye la fila igual que FALSE): sin esto,
    // un vehículo con seguimiento solo por km (sin fecha) que SÍ está en la
    // ventana de "próximo" se perdía silenciosamente del conteo.
    safeCount(`
      SELECT COUNT(*)::int AS total FROM vehiculos
      WHERE activo = true
        AND (fecha_proximo_mantenimiento IS NOT NULL OR proximo_km_mantenimiento IS NOT NULL)
        AND (COALESCE(fecha_proximo_mantenimiento <= CURRENT_DATE, false)
             OR COALESCE(proximo_km_mantenimiento <= kilometraje, false))
    `),
    safeCount(`
      SELECT COUNT(*)::int AS total FROM vehiculos
      WHERE activo = true
        AND (fecha_proximo_mantenimiento IS NOT NULL OR proximo_km_mantenimiento IS NOT NULL)
        AND NOT (COALESCE(fecha_proximo_mantenimiento <= CURRENT_DATE, false)
                 OR COALESCE(proximo_km_mantenimiento <= kilometraje, false))
        AND (COALESCE(fecha_proximo_mantenimiento <= CURRENT_DATE + INTERVAL '30 days', false)
             OR COALESCE((proximo_km_mantenimiento - COALESCE(kilometraje, 0)) <= 1500, false))
    `),
    safeCount("SELECT COUNT(*)::int AS total FROM mantenimiento_vehiculos WHERE fecha_realizada IS NOT NULL"),
    safeCount("SELECT COALESCE(SUM(costo), 0)::int AS total FROM mantenimiento_vehiculos WHERE fecha_realizada >= CURRENT_DATE - INTERVAL '30 days'"),
    // CUMPLIMIENTO = matriculación por placa (vencido = atrasada, crítico = por vencer ≤30d, vigente = al día)
    safeCount(`${CTE_MATRICULA}
      SELECT COUNT(*)::int AS total FROM veh
      WHERE mes IS NOT NULL AND NOT ${MAT_HECHO} AND ${MAT_FIN} < CURRENT_DATE`),
    safeCount(`${CTE_MATRICULA}
      SELECT COUNT(*)::int AS total FROM veh
      WHERE mes IS NOT NULL AND NOT ${MAT_HECHO}
        AND (${MAT_INICIO} - CURRENT_DATE) <= 30 AND ${MAT_FIN} >= CURRENT_DATE`),
    safeCount(`${CTE_MATRICULA}
      SELECT COUNT(*)::int AS total FROM veh
      WHERE mes IS NOT NULL AND (${MAT_HECHO} OR (${MAT_INICIO} - CURRENT_DATE) > 30)`),
    // DESEMPEÑO
    safeCount("SELECT COUNT(*)::int AS total FROM conductores WHERE estado IN ('disponible', 'en_servicio')"),
    safeCount("SELECT COUNT(*)::int AS total FROM conductores WHERE estado = 'inactivo'"),
    safeCount("SELECT COALESCE(AVG(rating_promedio)::int, 5) AS total FROM conductores WHERE rating_promedio IS NOT NULL"),
    safeCount("SELECT COUNT(*)::int AS total FROM conductores WHERE fecha_licencia_vencimiento IS NOT NULL AND fecha_licencia_vencimiento < CURRENT_DATE"),
    // RUTAS
    safeCount(`
      SELECT COUNT(*)::int AS total FROM (
        SELECT DISTINCT origen, destino FROM reservas
        WHERE origen IS NOT NULL AND destino IS NOT NULL
          AND fecha_reserva >= CURRENT_DATE - INTERVAL '30 days'
      ) t
    `),
    safeCount(`
      SELECT CASE WHEN COUNT(*) = 0 THEN 0
        ELSE ROUND(COUNT(*) FILTER (WHERE estado = 'cancelada')::numeric / COUNT(*) * 100)::int END AS total
      FROM reservas WHERE fecha_reserva >= CURRENT_DATE - INTERVAL '30 days'
    `),
  ]);

  const ocupacionVehicular = totalVehiculos > 0 ? Math.round((vehiculosActivos / totalVehiculos) * 100) : 0;
  const actividadReservas = reservasPendientes + reservasPendientePago + reservasConfirmadas + reservasEnCurso + reservasFinalizadas;
  const cargaOperativa = totalVehiculos > 0 ? Math.round((actividadReservas / Math.max(totalVehiculos * 5, 1)) * 100) : 0;

  const [tendenciaSemanalRaw, proximosMantenimiento, proximosCumplimiento] = await Promise.all([
    // Semana calendario actual (lunes a domingo), con los 7 días presentes aunque
    // algún día no tenga reservas. date_trunc('week', ...) en Postgres arranca en
    // lunes; el nombre del día se traduce a español en JS (evita depender del
    // locale del servidor de base de datos).
    pool.query(`
      WITH semana AS (
        SELECT generate_series(
          date_trunc('week', CURRENT_DATE)::date,
          date_trunc('week', CURRENT_DATE)::date + 6,
          '1 day'::interval
        )::date AS dia
      )
      SELECT s.dia, EXTRACT(ISODOW FROM s.dia)::int AS isodow, COUNT(r.id)::int AS total
      FROM semana s
      LEFT JOIN reservas r ON r.fecha_reserva::date = s.dia
      GROUP BY s.dia
      ORDER BY s.dia ASC
    `),
    // Próximos servicios de mantenimiento (por fecha o km), vengan vencidos o no.
    // COALESCE(..., false) evita que un vehículo con solo seguimiento por km (sin
    // fecha) quede como NULL: en Postgres, ORDER BY x DESC pone los NULL primero,
    // lo que lo colaría antes que uno realmente vencido.
    pool.query(`
      SELECT v.placa AS etiqueta, v.fecha_proximo_mantenimiento AS fecha,
             (v.fecha_proximo_mantenimiento - CURRENT_DATE) AS dias_restantes,
             COALESCE(v.fecha_proximo_mantenimiento <= CURRENT_DATE, false)
               OR COALESCE(v.proximo_km_mantenimiento <= v.kilometraje, false) AS vencido
      FROM vehiculos v
      WHERE v.activo = true
        AND (v.fecha_proximo_mantenimiento IS NOT NULL OR v.proximo_km_mantenimiento IS NOT NULL)
      ORDER BY vencido DESC, v.fecha_proximo_mantenimiento ASC NULLS LAST
      LIMIT 5
    `),
    // Próximas matrículas por vencer (o atrasadas), por vehículo según su placa.
    pool.query(`${CTE_MATRICULA}
      SELECT 'Matrícula · ' || placa AS etiqueta,
             ${MAT_FIN} AS fecha,
             (${MAT_FIN} - CURRENT_DATE) AS dias_restantes,
             (${MAT_FIN} < CURRENT_DATE) AS vencido
      FROM veh
      WHERE mes IS NOT NULL AND NOT ${MAT_HECHO}
        AND (${MAT_INICIO} - CURRENT_DATE) <= 30
      ORDER BY vencido DESC, fecha ASC
      LIMIT 5
    `),
  ]);

  const DIAS_ES = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
  const tendenciaSemanal = tendenciaSemanalRaw.rows.map((row) => ({
    etiqueta: DIAS_ES[row.isodow - 1],
    total: row.total,
  }));

  // ============ TIMELINE UNIFICADO DE VENCIMIENTOS ============
  // Junta mantenimiento y cumplimiento (hoy viven en pantallas separadas) en una
  // sola cola ordenada por urgencia, para que el admin no tenga que revisar
  // ambas por separado.
  const proximosVencimientos = [
    ...proximosMantenimiento.rows.map((r) => ({
      tipo: "mantenimiento",
      titulo: `Mantenimiento · ${r.etiqueta}`,
      fecha: r.fecha,
      diasRestantes: r.dias_restantes,
      vencido: r.vencido,
      link: LINK_POR_TIPO.mantenimiento,
    })),
    ...proximosCumplimiento.rows.map((r) => ({
      tipo: "cumplimiento",
      titulo: r.etiqueta,
      fecha: r.fecha,
      diasRestantes: r.dias_restantes,
      vencido: r.vencido,
      link: LINK_POR_TIPO.cumplimiento,
    })),
  ]
    .sort((a, b) => {
      if (a.vencido !== b.vencido) return a.vencido ? -1 : 1;
      return (a.diasRestantes ?? 999) - (b.diasRestantes ?? 999);
    })
    .slice(0, 6);

  const alertas: Array<{ tipo: string; prioridad: string; titulo: string; descripcion: string; link: string }> = [];

  // ============ ALERTAS DE MANTENIMIENTO ============
  if (mantenimientoVencido > 0) {
    alertas.push({
      tipo: "mantenimiento",
      prioridad: "alta",
      titulo: "Mantenimiento vencido",
      descripcion: `${mantenimientoVencido} servicio(s) de mantenimiento están vencidos y requieren atención inmediata.`,
      link: LINK_POR_TIPO.mantenimiento,
    });
  }

  if (mantenimientoPendiente > 0) {
    alertas.push({
      tipo: "mantenimiento",
      prioridad: mantenimientoPendiente > 5 ? "media" : "baja",
      titulo: "Mantenimiento próximo",
      descripcion: `${mantenimientoPendiente} servicio(s) de mantenimiento están programados en los próximos 30 días.`,
      link: LINK_POR_TIPO.mantenimiento,
    });
  }

  // ============ ALERTAS DE MATRICULACIÓN ============
  if (cumplimientoVencido > 0) {
    alertas.push({
      tipo: "cumplimiento",
      prioridad: "alta",
      titulo: "Matrículas atrasadas",
      descripcion: `${cumplimientoVencido} vehículo(s) no se matricularon en el mes que les tocaba. Regularización urgente.`,
      link: LINK_POR_TIPO.cumplimiento,
    });
  }

  if (cumplimientoCritico > 0) {
    alertas.push({
      tipo: "cumplimiento",
      prioridad: "media",
      titulo: "Matrículas por vencer",
      descripcion: `${cumplimientoCritico} vehículo(s) deben matricularse pronto (30 días o menos).`,
      link: LINK_POR_TIPO.cumplimiento,
    });
  }

  // ============ ALERTAS DE DESEMPEÑO ============
  if (licenciasVencidas > 0) {
    alertas.push({
      tipo: "licencias",
      prioridad: "alta",
      titulo: "Licencias de conducción vencidas",
      descripcion: `${licenciasVencidas} conductor(es) tiene(n) licencia(s) vencida(s). No pueden operar legalmente.`,
      link: LINK_POR_TIPO.licencias,
    });
  }

  if (conductoresInactivos > 0) {
    alertas.push({
      tipo: "conductores",
      prioridad: "baja",
      titulo: "Conductores inactivos",
      descripcion: `${conductoresInactivos} conductor(es) marcado(s) como inactivo(s) en el sistema.`,
      link: LINK_POR_TIPO.conductores,
    });
  }

  // ============ ALERTAS DE RUTAS ============
  if (tasaCancelacionRutas > 20 && rutasActivas > 0) {
    alertas.push({
      tipo: "rutas",
      prioridad: tasaCancelacionRutas > 40 ? "alta" : "media",
      titulo: "Cancelaciones por encima de lo normal",
      descripcion: `El ${tasaCancelacionRutas}% de las reservas de los últimos 30 días se cancelaron. Revisar causas (precio, disponibilidad, comunicación).`,
      link: LINK_POR_TIPO.rutas,
    });
  }

  // ============ ALERTAS DE PAGOS ============
  if (reservasPendientePago > 0) {
    alertas.push({
      tipo: "pagos",
      prioridad: reservasPendientePago > 5 ? "alta" : "media",
      titulo: "Reservas esperando confirmación de pago",
      descripcion: `${reservasPendientePago} reserva(s) tienen cotización aprobada pero aún no llega el pago completo. No quedarán confirmadas ni visibles al conductor hasta entonces.`,
      link: LINK_POR_TIPO.pagos,
    });
  }

  if (vehiculosSinAsignar > 0) {
    alertas.push({
      tipo: "asignacion",
      prioridad: vehiculosSinAsignar > 3 ? "alta" : "media",
      titulo: "Vehículos sin asignar",
      descripcion: `${vehiculosSinAsignar} vehículo(s) no tienen conductor vinculado.`,
      link: LINK_POR_TIPO.asignacion,
    });
  }

  if (reservasPendientes > 0) {
    alertas.push({
      tipo: "flujo",
      prioridad: reservasPendientes > 10 ? "alta" : "media",
      titulo: "Pendientes de revisión",
      descripcion: `${reservasPendientes} reserva(s) aún esperan validación operativa.`,
      link: LINK_POR_TIPO.flujo,
    });
  }

  if (vehiculosActivos < totalVehiculos) {
    alertas.push({
      tipo: "flota",
      prioridad: "media",
      titulo: "Flota parcialmente inactiva",
      descripcion: `${totalVehiculos - vehiculosActivos} vehículo(s) están desactivados en el sistema.`,
      link: LINK_POR_TIPO.flota,
    });
  }

  const PRIORIDAD_ORDEN = { alta: 0, media: 1, baja: 2 };
  alertas.sort((a, b) => PRIORIDAD_ORDEN[a.prioridad] - PRIORIDAD_ORDEN[b.prioridad]);

  return {
    resumen: {
      totalUsuarios,
      totalClientes,
      totalConductores,
      totalVehiculos,
      vehiculosActivos,
      vehiculosSinAsignar,
      reservasPendientes,
      reservasPendientePago,
      reservasConfirmadas,
      reservasEnCurso,
      reservasFinalizadas,
      ocupacionVehicular,
      cargaOperativa,
      // MANTENIMIENTO
      mantenimientoPendiente,
      mantenimientoVencido,
      mantenimientoCompletado,
      costomantenimientoMes,
      // CUMPLIMIENTO
      cumplimientoVencido,
      cumplimientoCritico,
      cumplimientoVigente,
      // DESEMPEÑO
      conductoresActivos,
      conductoresInactivos,
      ratingPromedioConductores,
      licenciasVencidas,
      // RUTAS
      rutasActivas,
      tasaCancelacionRutas,
    },
    tendenciaSemanal,
    proximosVencimientos,
    alertas,
  };
};

const getInteligenciaDashboard = async (_req, res) => {
  try {
    const data = await buildDashboardData();
    return res.status(200).json(data);
  } catch (error) {
    console.error("Error generando dashboard de inteligencia:", error);
    return res.status(500).json({ error: "Error interno del servidor" });
  }
};

const getAlertasInteligentes = async (_req, res) => {
  try {
    const data = await buildDashboardData();
    return res.status(200).json(data.alertas);
  } catch (error) {
    console.error("Error obteniendo alertas inteligentes:", error);
    return res.status(500).json({ error: "Error interno del servidor" });
  }
};

// Contadores livianos para los badges del sidebar del admin: cuántas
// cotizaciones esperan respuesta del admin (turno = 'admin') y cuántos
// comprobantes de pago están sin revisar. Se consulta aparte de
// buildDashboardData() (que hace muchas más queries) porque el sidebar
// lo sondea con frecuencia en todas las pantallas del panel.
const getBadgesSidebar = async (_req, res) => {
  try {
    const [cotizaciones, pagos, verificaciones, matriculas] = await Promise.all([
      safeCount(
        `SELECT COUNT(*) AS total FROM cotizaciones WHERE turno = 'admin' AND estado NOT IN ('aprobada', 'rechazada')`
      ),
      safeCount(`SELECT COUNT(*) AS total FROM pagos_reserva WHERE estado = 'pendiente'`),
      safeCount(`SELECT COUNT(*) AS total FROM usuarios WHERE LOWER(rol) = 'cliente' AND estado_verificacion = 'pendiente'`),
      // Vehículos que necesitan matricularse pronto (≤30 días antes de su mes),
      // están en su mes, o ya se pasaron y no se han matriculado este año.
      safeCount(`
        WITH veh AS (
          SELECT
            v.fecha_matricula,
            (SELECT mc.mes FROM matricula_calendario mc
             WHERE mc.digito = RIGHT(regexp_replace(v.placa, '[^0-9]', '', 'g'), 1)::int) AS mes
          FROM vehiculos v
          WHERE v.placa IS NOT NULL AND v.placa ~ '[0-9]'
        )
        SELECT COUNT(*) AS total FROM veh
        WHERE mes IS NOT NULL
          AND (fecha_matricula IS NULL OR EXTRACT(YEAR FROM fecha_matricula) < EXTRACT(YEAR FROM CURRENT_DATE))
          AND (make_date(EXTRACT(YEAR FROM CURRENT_DATE)::int, mes, 1) - CURRENT_DATE) <= 30
      `),
    ]);

    return res.status(200).json({
      "/admin/cotizaciones": cotizaciones,
      "/admin/pagos": pagos,
      "/admin/verificaciones": verificaciones,
      "/admin/cumplimiento": matriculas,
    });
  } catch (error) {
    console.error("Error obteniendo badges de sidebar:", error);
    return res.status(500).json({ error: "Error interno del servidor" });
  }
};

// ── Analítica inteligente: predicción de demanda, proyección de ingresos,
// tasa de conversión y recomendaciones automáticas (todo con datos reales) ────
const getAnaliticaInteligente = async (_req: any, res: any) => {
  const MES_C = ["", "Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
  const MES_L = ["", "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
  const DIA = ["", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"]; // ISODOW 1..7

  try {
    const [demMes, demDia, ingMes, promHist, conv, rutaTop, ociosos] = await Promise.all([
      pool.query(`
        SELECT EXTRACT(MONTH FROM fecha_reserva)::int AS mes, COUNT(*)::int AS total
        FROM reservas
        WHERE estado <> 'cancelada' AND fecha_reserva >= CURRENT_DATE - INTERVAL '12 months'
        GROUP BY 1 ORDER BY 1
      `),
      pool.query(`
        SELECT EXTRACT(ISODOW FROM fecha_reserva)::int AS dow, COUNT(*)::int AS total
        FROM reservas
        WHERE estado <> 'cancelada' AND fecha_reserva >= CURRENT_DATE - INTERVAL '6 months'
        GROUP BY 1 ORDER BY 1
      `),
      pool.query(`
        SELECT COALESCE(SUM(monto_pagado), 0)::numeric AS total
        FROM reservas
        WHERE date_trunc('month', fecha_reserva) = date_trunc('month', CURRENT_DATE)
      `),
      pool.query(`
        SELECT COALESCE(AVG(m.total), 0)::numeric AS prom FROM (
          SELECT date_trunc('month', fecha_reserva) AS mes, SUM(monto_pagado) AS total
          FROM reservas
          WHERE fecha_reserva >= CURRENT_DATE - INTERVAL '6 months'
          GROUP BY 1
        ) m
      `),
      pool.query(`
        SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE estado = 'aprobada')::int AS aprobadas
        FROM cotizaciones WHERE creado_en >= CURRENT_DATE - INTERVAL '90 days'
      `),
      pool.query(`
        SELECT origen, destino, COUNT(*)::int AS total
        FROM reservas
        WHERE estado <> 'cancelada' AND origen IS NOT NULL AND destino IS NOT NULL
          AND fecha_reserva >= CURRENT_DATE - INTERVAL '6 months'
        GROUP BY origen, destino ORDER BY total DESC LIMIT 1
      `),
      pool.query(`
        SELECT v.placa, (CURRENT_DATE - MAX(r.fecha_reserva)::date) AS dias_ocioso
        FROM vehiculos v
        LEFT JOIN reservas r ON r.vehiculo_id = v.id AND r.estado <> 'cancelada'
        WHERE v.activo = true AND v.placa IS NOT NULL
        GROUP BY v.id, v.placa
        HAVING MAX(r.fecha_reserva) IS NULL OR MAX(r.fecha_reserva)::date < CURRENT_DATE - 20
        ORDER BY dias_ocioso DESC NULLS FIRST LIMIT 3
      `),
    ]);

    const demandaMes = demMes.rows.map((r: any) => ({ etiqueta: MES_C[r.mes] || String(r.mes), total: r.total }));
    const mesPico = demMes.rows.length
      ? (() => { const t = demMes.rows.reduce((a: any, b: any) => (b.total > a.total ? b : a)); return { mes: MES_L[t.mes], total: t.total }; })()
      : null;

    const demandaDia = [1, 2, 3, 4, 5, 6, 7].map((d) => {
      const row = demDia.rows.find((x: any) => x.dow === d);
      return { etiqueta: DIA[d], total: row ? row.total : 0 };
    });
    const diaPico = demDia.rows.length
      ? (() => { const t = demDia.rows.reduce((a: any, b: any) => (b.total > a.total ? b : a)); return { dia: DIA[t.dow], total: t.total }; })()
      : null;

    const ingresosMes = Number(ingMes.rows[0]?.total || 0);
    const promedioHistorico = Number(promHist.rows[0]?.prom || 0);
    const hoy = new Date();
    const diaDelMes = hoy.getDate();
    const diasEnMes = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0).getDate();
    const proyeccionMes = diaDelMes > 0 ? Math.round((ingresosMes / diaDelMes) * diasEnMes) : Math.round(ingresosMes);

    const totalCot = Number(conv.rows[0]?.total || 0);
    const aprobadas = Number(conv.rows[0]?.aprobadas || 0);
    const tasa = totalCot > 0 ? Math.round((aprobadas / totalCot) * 100) : 0;

    const rutaMasPedida = rutaTop.rows[0] ? `${rutaTop.rows[0].origen} → ${rutaTop.rows[0].destino}` : null;
    const recomendaciones: string[] = [];
    for (const o of ociosos.rows.slice(0, 2)) {
      const dias = o.dias_ocioso != null ? `${o.dias_ocioso} días` : "un buen tiempo";
      recomendaciones.push(
        `El vehículo ${o.placa} no registra viajes hace ${dias}.` +
        (rutaMasPedida ? ` La ruta más pedida es ${rutaMasPedida} — considera asignarlo ahí.` : " Considera reasignarlo o promocionarlo.")
      );
    }
    if (diaPico) recomendaciones.push(`Los ${diaPico.dia.toLowerCase()} son tu día de mayor demanda — asegura flota disponible.`);
    if (totalCot >= 3 && tasa < 40) recomendaciones.push(`Tu tasa de conversión de cotizaciones es ${tasa}%. Revisa precios y contraofertas para cerrar más viajes.`);
    if (mesPico) recomendaciones.push(`Históricamente, ${mesPico.mes} es tu mes de mayor demanda — prepara la flota con anticipación.`);
    if (recomendaciones.length === 0) recomendaciones.push("Aún no hay suficientes datos para recomendaciones; se generarán a medida que se registren más viajes.");

    return res.json({
      success: true,
      demandaMes,
      demandaDia,
      mesPico,
      diaPico,
      proyeccion: { ingresosMes: Math.round(ingresosMes), proyeccionMes, promedioHistorico: Math.round(promedioHistorico) },
      conversion: { total: totalCot, aprobadas, tasa },
      recomendaciones,
    });
  } catch (error) {
    console.error("Error obteniendo analítica inteligente:", error);
    return res.status(500).json({ success: false, error: "Error interno del servidor" });
  }
};

const recomendarAsignacion = async (req: any, res: any) => {
  const fecha = typeof req.query.fecha === "string" ? req.query.fecha : new Date().toISOString().slice(0, 10);
  let fechaFin = typeof req.query.fecha_fin === "string" ? req.query.fecha_fin : fecha;
  const pasajeros = Number(req.query.pasajeros || 1);
  const horaInicio = typeof req.query.hora_inicio === "string" ? req.query.hora_inicio : null;
  const horaFin = typeof req.query.hora_fin === "string" ? req.query.hora_fin : null;
  const operationId = req.query.operacion_id === undefined ? null : Number(req.query.operacion_id);
  const soloDisponibles = req.query.solo_disponibles === "true";

  const isValidDate = (value: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  };
  if (!isValidDate(fecha) || !isValidDate(fechaFin) || fechaFin < fecha
    || !Number.isInteger(pasajeros) || pasajeros <= 0
    || (operationId !== null && (!Number.isInteger(operationId) || operationId <= 0))
    || (soloDisponibles && operationId === null)
    || (horaInicio !== null && !/^([01]\d|2[0-3]):[0-5]\d$/.test(horaInicio))
    || (horaFin !== null && !/^([01]\d|2[0-3]):[0-5]\d$/.test(horaFin))
    || (horaInicio && horaFin && horaFin <= horaInicio)) {
    return res.status(400).json({ success: false, error: "Fecha o cantidad de pasajeros inválida" });
  }

  try {
    if (operationId !== null) {
      const period = await pool.query(
        `SELECT COALESCE(o.fecha_fin_programada, r.fecha_fin, r.fecha_regreso, o.fecha_programada)::date::text AS fecha_fin
         FROM operaciones o
         LEFT JOIN reservas r ON r.id = o.reserva_id
         WHERE o.id = $1`,
        [operationId]
      );
      if (!period.rowCount) {
        return res.status(404).json({ success: false, error: "Operación no encontrada" });
      }
      fechaFin = period.rows[0].fecha_fin || fechaFin;
      if (!isValidDate(fechaFin) || fechaFin < fecha) {
        return res.status(400).json({ success: false, error: "El rango de fechas de la operación no es válido" });
      }
    }

    const evaluatedResult = await pool.query(`
      WITH vehiculos_evaluados AS (
        SELECT v.id AS vehiculo_id, v.placa, v.modelo, v.tipo, v.capacidad,
               v.estado, v.activo, v.fecha_proximo_mantenimiento,
               COALESCE(v.kilometraje, 0)::int AS kilometraje,
               v.proximo_km_mantenimiento,
               u.id AS conductor_id, u.nombre AS conductor_nombre,
               ARRAY_REMOVE(ARRAY[
                 CASE WHEN NOT v.activo THEN 'Vehículo desactivado' END,
                 CASE WHEN v.estado <> 'disponible' THEN 'Estado del vehículo: ' || COALESCE(v.estado, 'sin estado') END,
                 CASE WHEN v.capacidad < $3 THEN 'Capacidad insuficiente: ' || COALESCE(v.capacidad, 0) || ' plazas para ' || $3 || ' pasajeros' END,
                 CASE WHEN v.fecha_proximo_mantenimiento <= CURRENT_DATE
                   OR v.proximo_km_mantenimiento <= COALESCE(v.kilometraje, 0)
                   THEN 'Mantenimiento vencido por fecha o kilometraje' END,
                 (
                   SELECT 'Mantenimiento ' || string_agg(
                     CASE WHEN m.estado = 'en_progreso' THEN 'en curso'
                       ELSE 'programado el ' || to_char(m.fecha_programada, 'DD/MM/YYYY') END,
                     ', ' ORDER BY m.fecha_programada
                   )
                   FROM mantenimiento_vehiculos m
                   WHERE m.vehiculo_id = v.id
                     AND (m.estado = 'en_progreso'
                       OR (m.estado = 'programado' AND m.fecha_programada BETWEEN $1::date AND $2::date))
                 ),
                 (
                   SELECT 'No disponible según calendario manual el ' || string_agg(to_char(dia.fecha, 'DD/MM'), ', ' ORDER BY dia.fecha)
                   FROM generate_series($1::date, $2::date, INTERVAL '1 day') AS dia(fecha)
                   LEFT JOIN vehiculo_disponibilidad vd
                     ON vd.vehiculo_id = v.id AND vd.fecha = dia.fecha
                   WHERE vd.disponible = false
                 ),
                 (
                   SELECT 'No ofrece servicio los días: ' || string_agg(
                     to_char(dia.fecha, 'DD/MM'), ', ' ORDER BY dia.fecha
                   )
                   FROM generate_series($1::date, $2::date, INTERVAL '1 day') AS dia(fecha)
                   LEFT JOIN vehiculo_disponibilidad vd
                     ON vd.vehiculo_id = v.id AND vd.fecha = dia.fecha
                   WHERE vd.disponible IS NULL
                     AND NOT (EXTRACT(DOW FROM dia.fecha)::int = ANY(COALESCE(v.dias_servicio, ARRAY[0,1,2,3,4,5,6])))
                 ),
                 (
                   SELECT 'Conflicto con reserva #' || r.id || ' (' ||
                     to_char(COALESCE(r.fecha_salida::date, r.fecha_servicio::date, r.fecha_reserva::date), 'DD/MM/YYYY') || ')'
                   FROM reservas r
                   WHERE r.vehiculo_id = v.id
                     AND COALESCE(r.fecha_salida::date, r.fecha_servicio::date, r.fecha_reserva::date) <= $2::date
                     AND COALESCE(r.fecha_fin, r.fecha_regreso, r.fecha_salida::date, r.fecha_servicio::date, r.fecha_reserva::date) >= $1::date
                     AND r.estado NOT IN ('cancelada', 'finalizada')
                     AND NOT EXISTS (
                       SELECT 1 FROM operaciones propia
                       WHERE propia.id = $4::int AND propia.reserva_id = r.id
                     )
                     AND (
                       $1::date <> $2::date
                       OR COALESCE(r.fecha_fin, r.fecha_regreso, r.fecha_salida::date, r.fecha_servicio::date, r.fecha_reserva::date)
                            <> COALESCE(r.fecha_salida::date, r.fecha_servicio::date, r.fecha_reserva::date)
                       OR $5::time IS NULL OR $6::time IS NULL OR r.fecha_salida IS NULL OR r.fecha_llegada IS NULL
                       OR (r.fecha_salida::time < $6::time AND $5::time < r.fecha_llegada::time)
                     )
                   ORDER BY r.id
                   LIMIT 1
                 ),
                 (
                   SELECT CASE WHEN o.vehiculo_id = v.id
                     THEN 'Conflicto con vehículo en operación #'
                     ELSE 'Conductor asociado ocupado en operación #' END
                     || o.id || ' (' || to_char(o.fecha_programada, 'DD/MM/YYYY') || ')'
                   FROM operaciones o
                   LEFT JOIN conductores conductor_operacion ON conductor_operacion.id = o.conductor_id
                   WHERE (o.vehiculo_id = v.id OR conductor_operacion.usuario_id = u.id)
                     AND o.fecha_programada <= $2::date
                     AND COALESCE(o.fecha_fin_programada, o.fecha_programada) >= $1::date
                     AND o.id <> COALESCE($4::int, -1)
                     AND o.estado IN ('programada', 'asignada', 'en_curso', 'incidencia')
                     AND (
                       $1::date <> $2::date
                       OR COALESCE(o.fecha_fin_programada, o.fecha_programada) <> o.fecha_programada
                       OR $5::time IS NULL OR $6::time IS NULL OR o.hora_inicio IS NULL OR o.hora_fin IS NULL
                       OR (o.hora_inicio < $6::time AND $5::time < o.hora_fin)
                     )
                   ORDER BY o.id
                   LIMIT 1
                 ),
                 (
                   SELECT CASE WHEN d.motivo = 'fuera_de_servicio'
                     THEN 'Vehículo fuera de servicio por bloqueo externo'
                     ELSE 'Vehículo ocupado externamente'
                   END || ' (' || to_char(d.fecha_inicio, 'DD/MM/YYYY') || ')'
                   FROM disponibilidad_externa d
                   WHERE d.vehiculo_id = v.id
                     AND d.estado = 'activo'
                     AND d.fecha_inicio <= $2::date
                     AND d.fecha_fin >= $1::date
                     AND (
                       $1::date <> $2::date
                       OR d.hora_inicio IS NULL OR $5::time IS NULL
                       OR d.hora_fin IS NULL OR $6::time IS NULL
                       OR (d.hora_inicio < $6::time AND $5::time < d.hora_fin)
                     )
                   ORDER BY d.fecha_inicio, d.hora_inicio NULLS LAST, d.id
                   LIMIT 1
                 )
               ], NULL) AS bloqueos,
               ARRAY_REMOVE(ARRAY[
                 CASE WHEN u.id IS NULL THEN 'Sin conductor asociado; deberá seleccionarse uno al asignar' END,
                 CASE WHEN v.fecha_proximo_mantenimiento > CURRENT_DATE
                   AND (v.fecha_proximo_mantenimiento BETWEEN $1::date AND $2::date
                     OR v.fecha_proximo_mantenimiento <= $1::date + INTERVAL '7 days')
                   THEN 'Próximo mantenimiento: ' || to_char(v.fecha_proximo_mantenimiento, 'DD/MM/YYYY') END,
                 CASE WHEN v.proximo_km_mantenimiento IS NOT NULL
                   AND v.proximo_km_mantenimiento > COALESCE(v.kilometraje, 0)
                   AND v.proximo_km_mantenimiento - COALESCE(v.kilometraje, 0) <= 1500
                   THEN 'Próximo mantenimiento por kilometraje (' ||
                     (v.proximo_km_mantenimiento - COALESCE(v.kilometraje, 0)) || ' km restantes)' END
               ], NULL) AS advertencias
        FROM vehiculos v
        LEFT JOIN usuarios u ON u.id = v.usuario_id
      )
      SELECT * FROM vehiculos_evaluados
      ORDER BY cardinality(bloqueos), placa
    `, [fecha, fechaFin, pasajeros, operationId, horaInicio, horaFin]);

    if (soloDisponibles) {
      const availableDrivers = await pool.query(
        `SELECT u.id, u.nombre, u.apellido, u.activo,
                c.licencia, c.estado, c.fecha_licencia_vencimiento
         FROM conductores c
         INNER JOIN usuarios u ON u.id = c.usuario_id
         WHERE u.activo = true
           AND c.estado IS NOT NULL
           AND c.estado NOT IN ('inactivo', 'mantenimiento')
           AND c.fecha_licencia_vencimiento IS NOT NULL
           AND c.fecha_licencia_vencimiento >= CURRENT_DATE
           AND NOT EXISTS (
             SELECT 1
             FROM disponibilidad_externa d
             WHERE d.conductor_usuario_id = u.id
               AND d.estado = 'activo'
               AND d.motivo <> 'fuera_de_servicio'
               AND d.fecha_inicio <= $3::date
               AND d.fecha_fin >= $2::date
               AND (
                 $2::date <> $3::date OR d.hora_inicio IS NULL OR $4::time IS NULL
                 OR d.hora_fin IS NULL OR $5::time IS NULL
                 OR (d.hora_inicio < $5::time AND $4::time < d.hora_fin)
               )
           )
           AND NOT EXISTS (
             SELECT 1
             FROM operaciones o
             WHERE o.conductor_id = c.id
               AND o.id <> $1
               AND o.estado IN ('programada', 'asignada', 'en_curso', 'incidencia')
               AND o.fecha_programada <= $3::date
               AND COALESCE(o.fecha_fin_programada, o.fecha_programada) >= $2::date
               AND (
                 $2::date <> $3::date
                 OR COALESCE(o.fecha_fin_programada, o.fecha_programada) <> o.fecha_programada
                 OR $4::time IS NULL OR o.hora_inicio IS NULL OR $5::time IS NULL OR o.hora_fin IS NULL
                 OR (o.hora_inicio < $5::time AND $4::time < o.hora_fin)
               )
           )
           AND NOT EXISTS (
             SELECT 1
             FROM reservas r
             WHERE r.id <> COALESCE((SELECT reserva_id FROM operaciones WHERE id = $1), -1)
               AND r.estado NOT IN ('cancelada', 'finalizada')
               AND COALESCE(r.fecha_salida::date, r.fecha_servicio::date, r.fecha_reserva::date) <= $3::date
               AND COALESCE(r.fecha_fin, r.fecha_regreso, r.fecha_salida::date, r.fecha_servicio::date, r.fecha_reserva::date) >= $2::date
               AND r.conductor_id = CASE WHEN EXISTS (
                 SELECT 1
                 FROM information_schema.table_constraints tc
                 INNER JOIN information_schema.key_column_usage kcu
                   ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
                 INNER JOIN information_schema.constraint_column_usage ccu
                   ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
                 WHERE tc.table_schema = 'public'
                   AND tc.table_name = 'reservas'
                   AND tc.constraint_type = 'FOREIGN KEY'
                   AND kcu.column_name = 'conductor_id'
                   AND ccu.table_name = 'conductores'
               ) THEN c.id ELSE u.id END
               AND (
                 $2::date <> $3::date
                 OR COALESCE(r.fecha_fin, r.fecha_regreso, r.fecha_salida::date, r.fecha_servicio::date, r.fecha_reserva::date)
                      <> COALESCE(r.fecha_salida::date, r.fecha_servicio::date, r.fecha_reserva::date)
                 OR $4::time IS NULL OR r.fecha_salida IS NULL OR $5::time IS NULL OR r.fecha_llegada IS NULL
                 OR (r.fecha_salida::time < $5::time AND $4::time < r.fecha_llegada::time)
               )
           )
         ORDER BY u.nombre, u.apellido, u.id`,
        [operationId, fecha, fechaFin, horaInicio, horaFin]
      );

      return res.json({
        success: true,
        data: {
          vehiculos: evaluatedResult.rows
            .filter((vehicle: any) => vehicle.bloqueos.length === 0)
            .map((vehicle: any) => ({
              id: vehicle.vehiculo_id,
              placa: vehicle.placa,
              modelo: vehicle.modelo,
              capacidad: vehicle.capacidad,
              estado: vehicle.estado,
              activo: vehicle.activo,
            })),
          conductores: availableDrivers.rows,
        },
      });
    }

    const result = await pool.query(`
      WITH candidatos AS (
        SELECT
          v.id AS vehiculo_id, v.placa, v.modelo, v.tipo, v.capacidad,
          v.fecha_proximo_mantenimiento,
          u.id AS conductor_id, u.nombre AS conductor_nombre,
          COALESCE(c.rating_promedio, 0)::numeric AS rating,
          c.rating_promedio IS NOT NULL AS calificacion_registrada,
          COUNT(DISTINCT r.id) FILTER (
            WHERE r.estado NOT IN ('cancelada', 'finalizada')
              AND r.fecha_reserva >= CURRENT_DATE - INTERVAL '30 days'
          )::int AS carga_30_dias,
          COALESCE(v.kilometraje, 0)::int AS kilometraje,
          CASE
            WHEN v.fecha_proximo_mantenimiento IS NOT NULL
              AND v.fecha_proximo_mantenimiento <= $1::date + INTERVAL '7 days' THEN 0
            ELSE 1
          END AS mantenimiento_ok
        FROM vehiculos v
        LEFT JOIN usuarios u ON u.id = v.usuario_id
        LEFT JOIN conductores c ON c.usuario_id = u.id
        LEFT JOIN reservas r ON r.vehiculo_id = v.id
        WHERE v.activo = true
          AND v.estado = 'disponible'
          AND v.capacidad >= $2
          AND v.id = ANY($7::int[])
          AND NOT EXISTS (
            SELECT 1 FROM reservas ocupada
            WHERE ocupada.vehiculo_id = v.id
              AND COALESCE(ocupada.fecha_salida::date, ocupada.fecha_servicio::date, ocupada.fecha_reserva::date)
                    <= COALESCE((SELECT fecha_fin_programada FROM operaciones WHERE id = $5::int), $6::date, $1::date)
              AND COALESCE(ocupada.fecha_fin, ocupada.fecha_regreso, ocupada.fecha_salida::date, ocupada.fecha_servicio::date, ocupada.fecha_reserva::date) >= $1::date
              AND ocupada.estado NOT IN ('cancelada', 'finalizada')
              AND (
                $1::date <> COALESCE((SELECT fecha_fin_programada FROM operaciones WHERE id = $5::int), $6::date, $1::date)
                OR COALESCE(ocupada.fecha_fin, ocupada.fecha_regreso, ocupada.fecha_salida::date, ocupada.fecha_servicio::date, ocupada.fecha_reserva::date)
                     <> COALESCE(ocupada.fecha_salida::date, ocupada.fecha_servicio::date, ocupada.fecha_reserva::date)
                OR
                $3::time IS NULL OR $4::time IS NULL OR ocupada.fecha_salida IS NULL OR ocupada.fecha_llegada IS NULL
                OR (ocupada.fecha_salida::time < $4::time AND $3::time < ocupada.fecha_llegada::time)
              )
              AND NOT EXISTS (
                SELECT 1 FROM operaciones propia
                WHERE propia.id = $5 AND propia.reserva_id = ocupada.id
              )
          )
          AND NOT EXISTS (
            SELECT 1
            FROM operaciones o
            LEFT JOIN conductores conductor_operacion ON conductor_operacion.id = o.conductor_id
            WHERE o.fecha_programada <= COALESCE((SELECT fecha_fin_programada FROM operaciones WHERE id = $5::int), $6::date, $1::date)
              AND COALESCE(o.fecha_fin_programada, o.fecha_programada) >= $1::date
              AND o.id <> COALESCE($5::int, -1)
              AND o.estado IN ('programada', 'asignada', 'en_curso', 'incidencia')
              AND (o.vehiculo_id = v.id OR conductor_operacion.usuario_id = u.id)
              AND (
                $1::date <> COALESCE((SELECT fecha_fin_programada FROM operaciones WHERE id = $5::int), $6::date, $1::date)
                OR COALESCE(o.fecha_fin_programada, o.fecha_programada) <> o.fecha_programada
                OR
                $3::time IS NULL OR o.hora_inicio IS NULL OR $4::time IS NULL OR o.hora_fin IS NULL
                OR (o.hora_inicio < $4::time AND $3::time < o.hora_fin)
              )
          )
          AND NOT EXISTS (
            SELECT 1
            FROM mantenimiento_vehiculos m
            WHERE m.vehiculo_id = v.id
              AND (
                m.estado = 'en_progreso'
                OR (m.estado = 'programado'
                    AND m.fecha_programada BETWEEN $1::date
                      AND COALESCE(
                        (SELECT fecha_fin_programada FROM operaciones WHERE id = $5::int),
                        $6::date
                      ))
              )
          )
        GROUP BY v.id, u.id, u.nombre, c.rating_promedio
      )
      SELECT *,
        ROUND(((LEAST(capacidad, 60) / 60.0) * 30)::numeric, 2) AS puntaje_capacidad,
        ROUND(((LEAST(rating, 5) / 5.0) * 25)::numeric, 2) AS puntaje_calificacion,
        mantenimiento_ok * 25 AS puntaje_mantenimiento,
        GREATEST(0, 20 - LEAST(carga_30_dias, 20)) AS puntaje_carga,
        ROUND((
          (LEAST(capacidad, 60) / 60.0) * 30
          + (LEAST(rating, 5) / 5.0) * 25
          + (mantenimiento_ok * 25)
          + (GREATEST(0, 20 - LEAST(carga_30_dias, 20)))
        )::numeric, 2) AS puntaje
      FROM candidatos
      ORDER BY puntaje DESC, carga_30_dias ASC, kilometraje ASC
      LIMIT 5
    `, [fecha, pasajeros, horaInicio, horaFin, operationId, fechaFin,
      evaluatedResult.rows.filter((vehicle: any) => vehicle.bloqueos.length === 0).map((vehicle: any) => vehicle.vehiculo_id)]);

    const opciones = result.rows;
    const evaluados = evaluatedResult.rows.map((vehicle: any) => ({
      vehiculo_id: vehicle.vehiculo_id,
      placa: vehicle.placa,
      modelo: vehicle.modelo,
      tipo: vehicle.tipo,
      capacidad: vehicle.capacidad,
      conductor_id: vehicle.conductor_id,
      conductor_nombre: vehicle.conductor_nombre,
      bloqueos: vehicle.bloqueos,
      advertencias: vehicle.advertencias,
      elegible: vehicle.bloqueos.length === 0,
    }));
    if (!opciones.length) {
      return res.json({
        success: true,
        data: {
          fecha,
          fecha_fin: fechaFin,
          pasajeros,
          operacion_id: operationId,
          vehiculo: null,
          alternativas: [],
          evaluados,
          excluidos: evaluados.filter((vehicle: any) => !vehicle.elegible),
          decisionId: null,
        },
      });
    }

    const opcionesExplicadas = opciones.map((opcion: any) => ({
      ...opcion,
      desglose: {
        capacidad: Number(opcion.puntaje_capacidad),
        calificacion: Number(opcion.puntaje_calificacion),
        mantenimiento: Number(opcion.puntaje_mantenimiento),
        cargaOperativa: Number(opcion.puntaje_carga),
      },
      razones: [
        `Capacidad: ${opcion.capacidad} plazas (${Number(opcion.puntaje_capacidad)}/30 puntos).`,
        opcion.conductor_nombre
          ? opcion.calificacion_registrada
            ? `Calificación del conductor: ${Number(opcion.rating).toFixed(1)}/5 (${Number(opcion.puntaje_calificacion)}/25 puntos).`
            : "El conductor no tiene calificación registrada; obtiene 0/25 puntos en este criterio."
          : "No tiene un conductor asociado; por eso no obtiene puntos de calificación.",
        opcion.fecha_proximo_mantenimiento == null
          ? "No hay fecha de próximo mantenimiento registrada; se asignan 25/25 puntos y conviene verificar el dato."
          : Number(opcion.mantenimiento_ok)
            ? "La fecha de próximo mantenimiento queda fuera de los siguientes 7 días (+25 puntos)."
            : "El mantenimiento está vencido o previsto dentro de los próximos 7 días (0/25 puntos).",
        `Carga de ${opcion.carga_30_dias} reservas en los últimos 30 días (${Number(opcion.puntaje_carga)}/20 puntos).`,
      ],
    }));

    const recomendacion = {
      fecha,
      fecha_fin: fechaFin,
      pasajeros,
      hora_inicio: horaInicio,
      hora_fin: horaFin,
      operacion_id: operationId,
      vehiculo: opcionesExplicadas[0],
      alternativas: opcionesExplicadas.slice(1),
      evaluados,
      excluidos: evaluados.filter((vehicle: any) => !vehicle.elegible),
      filtrosAplicados: [
        "Vehículo activo y disponible",
        "Capacidad suficiente para los pasajeros",
        "Sin solapamiento con reservas existentes en el horario seleccionado",
        "Sin conflicto de horario con otra operación activa",
        "Sin mantenimiento programado durante las fechas del servicio",
      ],
      criterios: ["capacidad", "disponibilidad", "mantenimiento", "calificación", "carga operativa"],
    };

    const decision = await pool.query(
      `INSERT INTO decisiones_sistema (tipo_decision, entidad_id, recomendacion, factores)
       VALUES ('asignacion_vehiculo', $1, $2::jsonb, $3::jsonb)
       RETURNING id`,
      [
        opcionesExplicadas[0].vehiculo_id,
        JSON.stringify(recomendacion),
        JSON.stringify({
          fecha,
          pasajeros,
          opciones_evaluadas: opcionesExplicadas.length,
          pesos: { capacidad: 30, calificacion: 25, mantenimiento: 25, carga_operativa: 20 },
        }),
      ]
    );

    return res.json({ success: true, data: { ...recomendacion, decisionId: decision.rows[0].id } });
  } catch (error) {
    console.error("Error generando recomendación de asignación:", error);
    return res.status(500).json({ success: false, error: "No se pudo generar la recomendación" });
  }
};

const registrarDecisionAsignacion = async (req: any, res: any) => {
  const decisionId = Number(req.params.id);
  const vehiculoId = Number(req.body?.vehiculo_id);
  const resultado = req.body?.resultado;
  const motivo = typeof req.body?.motivo === "string" ? req.body.motivo.trim() : "";
  const usuarioId = Number(req.user?.id);

  if (!Number.isInteger(decisionId) || decisionId <= 0
    || !Number.isInteger(vehiculoId) || vehiculoId <= 0
    || !["aceptada", "alternativa"].includes(resultado)
    || !Number.isInteger(usuarioId) || usuarioId <= 0
    || (resultado === "alternativa" && !motivo)
    || motivo.length > 500) {
    return res.status(400).json({ success: false, error: "La decisión, el vehículo o el motivo no son válidos" });
  }

  try {
    const updated = await pool.query(
      `UPDATE decisiones_sistema
       SET entidad_id = $2,
           resultado = $3,
           confirmado_por = $4,
           factores = factores || jsonb_build_object(
             'decision_operador',
             jsonb_build_object(
               'vehiculo_id', $2,
               'resultado', $3,
               'motivo', NULLIF($5, ''),
               'registrado_en', CURRENT_TIMESTAMP
             )
           )
       WHERE id = $1
         AND tipo_decision = 'asignacion_vehiculo'
         AND resultado IS NULL
         AND (
           ($3 = 'aceptada' AND (recomendacion->'vehiculo'->>'vehiculo_id')::int = $2)
           OR (
             $3 = 'alternativa'
             AND EXISTS (
               SELECT 1
               FROM jsonb_array_elements(recomendacion->'alternativas') AS opciones(opcion)
               WHERE (opciones.opcion->>'vehiculo_id')::int = $2
             )
           )
         )
       RETURNING id`,
      [decisionId, vehiculoId, resultado, usuarioId, motivo]
    );

    if (!updated.rowCount) {
      return res.status(409).json({
        success: false,
        error: "La decisión ya fue registrada o el vehículo no pertenece a las opciones recomendadas",
      });
    }
    return res.json({ success: true, message: "Decisión registrada correctamente" });
  } catch (error) {
    console.error("Error registrando decisión de asignación:", error);
    return res.status(500).json({ success: false, error: "No se pudo registrar la decisión" });
  }
};

const getIndicesDesempeno = async (_req: any, res: any) => {
  try {
    const [vehiculos, conductores, rutas] = await Promise.all([
      pool.query(`
        SELECT v.id, v.placa, v.modelo,
          COUNT(DISTINCT r.id) FILTER (WHERE r.estado NOT IN ('cancelada'))::int AS viajes,
          COUNT(DISTINCT m.id)::int AS mantenimientos,
          ROUND((
            LEAST(COUNT(DISTINCT r.id) * 10, 40)
            + CASE WHEN v.estado = 'disponible' THEN 30 WHEN v.estado = 'en_servicio' THEN 25 ELSE 10 END
            + CASE WHEN v.fecha_proximo_mantenimiento IS NULL OR v.fecha_proximo_mantenimiento > CURRENT_DATE THEN 30 ELSE 10 END
          )::numeric, 2) AS indice
        FROM vehiculos v
        LEFT JOIN reservas r ON r.vehiculo_id = v.id
        LEFT JOIN mantenimiento_vehiculos m ON m.vehiculo_id = v.id
        WHERE v.activo = true
        GROUP BY v.id
        ORDER BY indice DESC
      `),
      pool.query(`
        SELECT u.id, u.nombre, COALESCE(c.rating_promedio, 0)::numeric AS rating,
          COUNT(DISTINCT r.id) FILTER (WHERE r.estado NOT IN ('cancelada'))::int AS viajes,
          ROUND((LEAST(COALESCE(c.rating_promedio, 0) * 12, 60)
            + LEAST(COUNT(DISTINCT r.id) * 4, 40))::numeric, 2) AS indice
        FROM usuarios u
        JOIN conductores c ON c.usuario_id = u.id
        LEFT JOIN reservas r ON r.conductor_id = u.id
        WHERE u.activo = true
        GROUP BY u.id, u.nombre, c.rating_promedio
        ORDER BY indice DESC
      `),
      pool.query(`
        SELECT origen, destino, COUNT(*) FILTER (WHERE estado <> 'cancelada')::int AS viajes,
          COALESCE(ROUND(AVG(num_personas)::numeric, 2), 0) AS pasajeros_promedio,
          COALESCE(ROUND(AVG(total)::numeric, 2), 0) AS ingreso_promedio
        FROM reservas
        WHERE origen IS NOT NULL AND destino IS NOT NULL
        GROUP BY origen, destino
        ORDER BY viajes DESC
        LIMIT 50
      `),
    ]);

    return res.json({
      success: true,
      data: {
        vehiculos: vehiculos.rows,
        conductores: conductores.rows,
        rutas: rutas.rows,
      },
    });
  } catch (error) {
    console.error("Error obteniendo índices de desempeño:", error);
    return res.status(500).json({ success: false, error: "No se pudieron obtener los índices" });
  }
};

module.exports = {
  getInteligenciaDashboard,
  getAlertasInteligentes,
  getBadgesSidebar,
  getAnaliticaInteligente,
  recomendarAsignacion,
  registrarDecisionAsignacion,
  getIndicesDesempeno,
};
