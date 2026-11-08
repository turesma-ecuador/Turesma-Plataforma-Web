export {};

const express = require("express");
const { verifyToken, requireRole } = require("../middleware/auth.middleware");
const {
  getCatalogo,
  listarReservas,
  crearReserva,
  editarReserva,
  eliminarReserva,
  verEstadoViaje,
  actualizarEstadoViaje,
  listarRutasConductorDesdeReservas,
  listarVehiculos,
  registrarVehiculo,
  editarVehiculo,
  eliminarVehiculo,
  reordenarVehiculos,
  verVehiculosDisponibles,
  listarConductores,
  registrarConductor,
  editarConductor,
  eliminarConductor,
  verConductoresDisponibles,
  verDisponibilidad,
  obtenerDisponibilidadVehiculo,
  actualizarDisponibilidadVehiculo,
  historialViajes,
  historialReservas,
  viajesFinalizados,
  reporteViajes,
  reporteReservas,
  reporteVehiculosUsados,
  verHistorial,
  verReportes,
  crearUsuarioAdmin,
  listarUsuariosAdmin,
  editarUsuarioAdmin,
  cambiarCorreoClienteAdmin,
  reenviarVerificacionCorreoClienteAdmin,
  eliminarUsuarioAdmin,
  recuperarPasswordUsuarioAdmin,
  getInteligenciaDashboard,
  getAlertasInteligentes,
  getBadgesSidebar,
  getAnaliticaInteligente,
  recomendarAsignacion,
  registrarDecisionAsignacion,
  getIndicesDesempeno,
  exportarReporteCSV,
  getTarifas,
  updateTarifas,
} = require("../controllers/admin.controller");
const {
  getMantenimientoVehiculos,
  getMantenimientoProximo,
  getMantenimientoResumen,
  completarMantenimientoProgramado,
  reprogramarMantenimiento,
} = require("../controllers/admin/mantenimiento.admin.controller");
const {
  getRutasAnalisis,
  getRutasResumen,
  createRuta,
  updateRuta,
  getRecomendacionesRutas,
  getRutasDesdeReservas,
} = require("../controllers/admin/rutas-analisis.admin.controller");
const {
  getRutasReportadas,
  getRutasReportadasResumen,
} = require("../controllers/admin/rutas-reportadas.admin.controller");
const { uploadVehiculoImagen, uploadViajeImagenes } = require("../controllers/admin/uploads.admin.controller");
const { serveComprobante } = require("../controllers/uploads.controller");
const { listarPagosAdmin, descargarReciboPagoAdmin, descargarFacturaAdmin, emitirFacturaAdmin, reenviarFacturaAdmin, aprobarPago, rechazarPago, actualizarLinkPago, registrarPagoManual, registrarReembolso } = require("../controllers/admin/pagos.admin.controller");
const {
  listarSolicitudesCambioDestinoAdmin,
  proponerCambioDestino,
  rechazarSolicitudCambioDestino,
  registrarDevolucionCambioDestino,
} = require("../controllers/cambios-destino.controller");
const { historialReservaAdmin } = require("../controllers/admin/reservas-historial.admin.controller");
const { getDashboardData } = require("../controllers/admin/dashboard.admin.controller");
const { getControlOperativo, getAnomalias } = require("../controllers/admin/control-operativo.admin.controller");
const { getHistorialMensual } = require("../controllers/admin/historial.admin.controller");
const { getProformaCotizacion, enviarProformaCotizacion } = require("../controllers/admin/proforma.admin.controller");
const {
  listarAsignaciones,
  crearAsignacion,
  finalizarAsignacion,
  historialAsignaciones,
  conductoresDisponiblesParaAsignar,
  vehiculosDisponiblesParaAsignar,
} = require("../controllers/admin/asignaciones.admin.controller");
const {
  listarCotizaciones,
  aprobarCotizacion,
  obtenerNegociacion,
  rechazarCotizacion,
  crearCotizacion,
  listarMisCotizaciones,
  resumenCotizaciones,
} = require("../controllers/admin/cotizaciones.admin.controller");
const { obtenerUbicacionesActuales } = require("../controllers/admin/ubicaciones.admin.controller");
const {
  listarRequerimientosAdmin,
  actualizarRequerimientoAdmin,
  descargarProformaRequerimientoAdmin,
  reintentarDespachoRequerimiento,
} = require("../controllers/requerimientos-personalizados.controller");
const {
  listarVerificaciones,
  contarVerificacionesPendientes,
  aprobarVerificacion,
  rechazarVerificacion,
} = require("../controllers/admin/verificaciones.admin.controller");
const {
  uploadGaleriaImagen,
  uploadGaleriaVideo,
  listarGaleriaAdmin,
  crearGaleria,
  actualizarGaleria,
  eliminarGaleria,
  reordenarVideosGaleria,
} = require("../controllers/admin/galeria.admin.controller");
const {
  listarMatriculas,
  getCalendario,
  actualizarCalendario,
  marcarMatriculado,
} = require("../controllers/admin/matriculas.admin.controller");
const {
  listarOperaciones,
  listarReservasPorDespachar,
  crearOperacionDesdeReserva,
  crearOperacion,
  asignarOperacion,
  actualizarSubcontratacion,
  actualizarEstadoOperacion,
  reabrirOperacion,
  historialOperacion,
} = require("../controllers/admin/operaciones.admin.controller");
const { consultarChatbotAdmin } = require("../controllers/admin/chatbot.admin.controller");
const { getCalendarioFlota } = require("../controllers/admin/calendario-flota.admin.controller");
const {
  listarEmpresasAsociadas,
  crearEmpresaAsociada,
  actualizarEmpresaAsociada,
  crearVehiculoAsociado,
  actualizarVehiculoAsociado,
} = require("../controllers/admin/empresas-asociadas.admin.controller");
const {
  getAdminHomeShowcaseImages,
  updateHomeShowcaseImage,
} = require("../controllers/home-showcase.controller");
const {
  listarViajesAdmin,
  crearViajeAdmin,
  actualizarViajeAdmin,
  eliminarViajeAdmin,
} = require("../controllers/admin/viajes.admin.controller");

const router = express.Router();

// ============ MIDDLEWARE DE AUTENTICACIÓN GLOBAL PARA RUTAS ADMIN ============
// Todas las rutas de /api/admin requieren token JWT válido y rol admin u operativo
router.use(verifyToken);
router.use(requireRole("admin", "operativo"));

router.get("/catalogo", getCatalogo);
router.get("/tarifas", getTarifas);
router.put("/tarifas", updateTarifas);
router.get("/home-showcase-images", getAdminHomeShowcaseImages);
router.put("/home-showcase-images/:slot", updateHomeShowcaseImage);

// ── DASHBOARD PRINCIPAL ───────────────────────────────────────────────────────
router.get("/dashboard", getDashboardData);
router.get("/control-operativo", getControlOperativo);
router.get("/historial/mensual", getHistorialMensual);

router.get("/operaciones", listarOperaciones);
router.get("/calendario-flota", requireRole("admin"), getCalendarioFlota);
router.get("/operaciones/reservas-pendientes", listarReservasPorDespachar);
router.post("/operaciones/reservas/:id/despachar", crearOperacionDesdeReserva);
router.post("/operaciones", crearOperacion);
router.patch("/operaciones/:id/asignar", asignarOperacion);
router.patch("/operaciones/:id/subcontratacion", actualizarSubcontratacion);
router.patch("/operaciones/:id/estado", actualizarEstadoOperacion);
router.patch("/operaciones/:id/reabrir", reabrirOperacion);
router.get("/operaciones/:id/historial", historialOperacion);
router.get("/empresas-asociadas", listarEmpresasAsociadas);
router.post("/empresas-asociadas", requireRole("admin"), crearEmpresaAsociada);
router.patch("/empresas-asociadas/:id", requireRole("admin"), actualizarEmpresaAsociada);
router.post("/empresas-asociadas/:id/vehiculos", requireRole("admin"), crearVehiculoAsociado);
router.patch("/empresas-asociadas/vehiculos/:id", requireRole("admin"), actualizarVehiculoAsociado);
router.post("/chatbot", consultarChatbotAdmin);
router.get("/viajes", listarViajesAdmin);
router.post("/viajes", crearViajeAdmin);
router.put("/viajes/:id", actualizarViajeAdmin);
router.delete("/viajes/:id", eliminarViajeAdmin);

router.get("/inteligencia/dashboard", getInteligenciaDashboard);
router.get("/inteligencia/alertas", getAlertasInteligentes);
router.get("/inteligencia/analitica", getAnaliticaInteligente);
router.get("/inteligencia/asignacion-recomendada", recomendarAsignacion);
router.patch("/inteligencia/asignacion-recomendada/:id/decision", registrarDecisionAsignacion);
router.get("/inteligencia/desempeno", getIndicesDesempeno);
router.get("/inteligencia/anomalias", getAnomalias);
router.get("/badges-sidebar", getBadgesSidebar);

// Verificación de identidad de clientes
router.get("/verificaciones", listarVerificaciones);
router.get("/verificaciones/pendientes", contarVerificacionesPendientes);
router.patch("/verificaciones/:id/aprobar", aprobarVerificacion);
router.patch("/verificaciones/:id/rechazar", rechazarVerificacion);

router.get("/reservas", listarReservas);
router.get("/reservas/rutas-conductor", listarRutasConductorDesdeReservas);
router.post("/reservas", crearReserva);
router.put("/reservas/:id", editarReserva);
router.delete("/reservas/:id", eliminarReserva);
router.get("/reservas/:id/estado-viaje", verEstadoViaje);
router.patch("/reservas/:id/estado-viaje", requireRole("admin"), actualizarEstadoViaje);
router.get("/solicitudes-cambio-destino", requireRole("admin"), listarSolicitudesCambioDestinoAdmin);
router.post("/solicitudes-cambio-destino/:solicitudId/propuesta", requireRole("admin"), proponerCambioDestino);
router.post("/solicitudes-cambio-destino/:solicitudId/rechazar", requireRole("admin"), rechazarSolicitudCambioDestino);
router.post("/solicitudes-cambio-destino/:solicitudId/devolucion", requireRole("admin"), registrarDevolucionCambioDestino);

router.get("/vehiculos", listarVehiculos);
router.post("/vehiculos", registrarVehiculo);
router.patch("/vehiculos/orden", reordenarVehiculos);
router.put("/vehiculos/:id", editarVehiculo);
router.delete("/vehiculos/:id", eliminarVehiculo);
router.get("/vehiculos/disponibles", verVehiculosDisponibles);
router.get("/vehiculos/:id/disponibilidad", obtenerDisponibilidadVehiculo);
router.patch("/vehiculos/:id/disponibilidad", actualizarDisponibilidadVehiculo);

router.get("/conductores", listarConductores);
router.post("/conductores", registrarConductor);
router.put("/conductores/:id", editarConductor);
router.delete("/conductores/:id", eliminarConductor);
router.get("/conductores/disponibles", verConductoresDisponibles);

// ============ RUTAS DE ASIGNACIONES ============
router.get("/asignaciones", listarAsignaciones);
router.post("/asignaciones", crearAsignacion);
router.patch("/asignaciones/:id/finalizar", finalizarAsignacion);
router.get("/asignaciones/historial", historialAsignaciones);
router.get("/asignaciones/conductores-disponibles", conductoresDisponiblesParaAsignar);
router.get("/asignaciones/vehiculos-disponibles", vehiculosDisponiblesParaAsignar);

router.get("/historial/viajes", historialViajes);
router.get("/historial/reservas", historialReservas);
router.get("/historial/viajes-finalizados", viajesFinalizados);

router.get("/reportes/viajes", reporteViajes);
router.get("/reportes/reservas", reporteReservas);
router.get("/reportes/vehiculos-usados", reporteVehiculosUsados);

router.get("/disponibilidad", verDisponibilidad);

router.post("/usuarios", crearUsuarioAdmin);
router.get("/usuarios", listarUsuariosAdmin);
router.put("/usuarios/:id", editarUsuarioAdmin);
router.patch("/usuarios/:id/correo", requireRole("admin"), cambiarCorreoClienteAdmin);
router.post("/usuarios/:id/correo/verificacion", requireRole("admin"), reenviarVerificacionCorreoClienteAdmin);
router.delete("/usuarios/:id", eliminarUsuarioAdmin);
router.patch("/usuarios/:id/recuperar-password", recuperarPasswordUsuarioAdmin);
router.post("/uploads/vehiculo-imagen", uploadVehiculoImagen);
router.post("/uploads/viaje-imagenes", uploadViajeImagenes);
router.get("/pagos", listarPagosAdmin);
router.post("/pagos/:id/reembolso", requireRole("admin"), registrarReembolso);
router.get("/pagos/:id/recibo", descargarReciboPagoAdmin);
router.get("/reservas/:id/factura", descargarFacturaAdmin);
router.post("/reservas/:id/factura/emitir", emitirFacturaAdmin);
router.post("/reservas/:id/factura/reenviar", reenviarFacturaAdmin);
router.patch("/pagos/:id/aprobar", aprobarPago);
router.patch("/pagos/:id/rechazar", rechazarPago);
router.patch("/reservas/:id/link-pago", actualizarLinkPago);
router.post("/reservas/:id/pago-manual", registrarPagoManual);

router.get("/historial", verHistorial);
router.get("/reservas/:id/historial", historialReservaAdmin);
router.get("/reportes", verReportes);
router.get("/reportes/exportar-csv", exportarReporteCSV);

// ============ RUTAS DE MANTENIMIENTO VEHICULAR ============
router.get("/mantenimiento", getMantenimientoVehiculos);
router.get("/mantenimiento/proximo", getMantenimientoProximo);
router.get("/mantenimiento/resumen", getMantenimientoResumen);
router.patch("/mantenimiento/:vehiculoId/completar", completarMantenimientoProgramado);
router.patch("/mantenimiento/:vehiculoId/reprogramar", reprogramarMantenimiento);

// ============ RUTAS DE ANÁLISIS DE RUTAS ============
router.get("/rutas-analisis", getRutasAnalisis);
router.post("/rutas-analisis", createRuta);
router.put("/rutas-analisis/:id", updateRuta);
router.get("/rutas-analisis/resumen", getRutasResumen);
router.get("/rutas-analisis/recomendaciones", getRecomendacionesRutas);
router.get("/rutas-analisis/dinamico", getRutasDesdeReservas);

router.get("/rutas-reportadas", getRutasReportadas);
router.get("/rutas-reportadas/resumen", getRutasReportadasResumen);

// ============ RUTAS DE COTIZACIONES ============
router.get("/cotizaciones", listarCotizaciones);
router.get("/cotizaciones/resumen", resumenCotizaciones);
router.post("/cotizaciones", crearCotizacion);
router.patch("/cotizaciones/:id/aprobar", aprobarCotizacion);
router.patch("/cotizaciones/:id/rechazar", rechazarCotizacion);
router.get("/cotizaciones/:id/negociacion", obtenerNegociacion);
router.get("/cotizaciones/:id/proforma", getProformaCotizacion);
router.post("/cotizaciones/:id/proforma/enviar", enviarProformaCotizacion);
router.get("/cotizaciones/cliente/:usuario_id", listarMisCotizaciones);
router.get("/requerimientos-personalizados", listarRequerimientosAdmin);
router.patch("/requerimientos-personalizados/:id", actualizarRequerimientoAdmin);
router.get("/requerimientos-personalizados/:id/proforma", descargarProformaRequerimientoAdmin);
router.post("/requerimientos-personalizados/:id/preparar-despacho", requireRole("admin"), reintentarDespachoRequerimiento);

// ============ UBICACIÓN EN VIVO DE VEHÍCULOS ============
router.get("/ubicaciones", obtenerUbicacionesActuales);
router.get("/pagos/comprobantes/:filename", serveComprobante);

// ============ GALERÍA DE VIAJES (fotos para la landing pública) ============
router.post("/uploads/galeria-imagen", uploadGaleriaImagen);
router.post("/uploads/galeria-video", uploadGaleriaVideo);
router.get("/galeria", listarGaleriaAdmin);
router.post("/galeria", crearGaleria);
router.patch("/galeria/orden-videos", reordenarVideosGaleria);
router.patch("/galeria/:id", actualizarGaleria);
router.delete("/galeria/:id", eliminarGaleria);

// ============ MATRICULACIÓN VEHICULAR (automática por placa) ============
router.get("/matriculas", listarMatriculas);
router.get("/matriculas/calendario", getCalendario);
router.put("/matriculas/calendario", actualizarCalendario);
router.patch("/matriculas/:vehiculoId/matriculado", marcarMatriculado);

module.exports = router;
