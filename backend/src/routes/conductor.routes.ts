export {};

const express = require("express");
const { verifyToken, requireRole, requireSelfOrRole } = require("../middleware/auth.middleware");
const {
  listarReservasConductor,
  listarMisReservasConductor,
  aceptarReservaConductor,
  rechazarReservaConductor,
  actualizarEstadoReservaConductor,
  reportarIncidenciaReservaConductor,
  actualizarEstadoOperacionConductor,
  confirmarRecepcionOperacionConductor,
  marcarLlegadaDestinoConductor,
  marcarRecogidoConductor,
  obtenerDisponibilidadConductor,
  listarDisponibilidadExterna,
  crearReporteRutaConductor,
  listarReportesRutaConductor,
  obtenerMiVehiculoConductor,
  listarMantenimientoConductor,
  crearMantenimientoConductor,
  compartirUbicacionConductor,
  listarClientesConductor,
  registrarViajeConductor,
} = require("../controllers/conductor.controller");
const {
  listDriverVehicleUnavailability: listarIndisponibilidadesMantenimiento,
} = require("../controllers/vehiculo-indisponibilidades.controller");

const router = express.Router();

// Todas las rutas de conductor requieren token JWT válido
router.use(verifyToken);
router.use("/:id(\\d+)", requireSelfOrRole("admin", "operativo"));

router.get("/me/reservas", requireRole("conductor", "vehiculo"), listarMisReservasConductor);
router.get("/:id/reservas", listarReservasConductor);
router.patch("/:id/reservas/:reservaId/aceptar", aceptarReservaConductor);
router.patch("/:id/reservas/:reservaId/rechazar", rechazarReservaConductor);
router.patch("/:id/reservas/:reservaId/estado", actualizarEstadoReservaConductor);
router.patch("/:id/reservas/:reservaId/incidencia", requireRole("conductor", "vehiculo"), reportarIncidenciaReservaConductor);
router.patch("/:id/operaciones/:operationId/estado", actualizarEstadoOperacionConductor);
router.patch("/:id/operaciones/:operationId/confirmar-asignacion", requireRole("conductor", "vehiculo"), confirmarRecepcionOperacionConductor);
router.patch("/:id/operaciones/:operationId/llegada", requireRole("conductor", "vehiculo"), marcarLlegadaDestinoConductor);
router.patch("/:id/reservas/:reservaId/recoger", marcarRecogidoConductor);
router.get("/:id/disponibilidad", obtenerDisponibilidadConductor);
router.get("/:id/disponibilidad-externa", listarDisponibilidadExterna);
router.get("/:id/rutas", listarReportesRutaConductor);
router.post("/:id/rutas", crearReporteRutaConductor);
router.get("/:id/vehiculo", obtenerMiVehiculoConductor);
router.get("/:id/mantenimiento", listarMantenimientoConductor);
router.post("/:id/mantenimiento", crearMantenimientoConductor);
router.get("/:id/indisponibilidades-mantenimiento", listarIndisponibilidadesMantenimiento);
router.post("/:id/ubicacion", compartirUbicacionConductor);
router.get("/:id/clientes", listarClientesConductor);
router.post("/:id/registrar-viaje", registrarViajeConductor);

module.exports = router;
