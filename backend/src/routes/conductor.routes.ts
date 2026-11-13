export {};

const express = require("express");
const { verifyToken, requireRole, requireSelfOrRole } = require("../middleware/auth.middleware");
const {
  listarReservasConductor,
  listarMisReservasConductor,
  aceptarReservaConductor,
  rechazarReservaConductor,
  actualizarEstadoReservaConductor,
  actualizarEstadoOperacionConductor,
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
} = require("../controllers/conductor.controller");

const router = express.Router();

// Todas las rutas de conductor requieren token JWT válido
router.use(verifyToken);
router.use("/:id(\\d+)", requireSelfOrRole("admin", "operativo"));

router.get("/me/reservas", requireRole("conductor", "vehiculo"), listarMisReservasConductor);
router.get("/:id/reservas", listarReservasConductor);
router.patch("/:id/reservas/:reservaId/aceptar", aceptarReservaConductor);
router.patch("/:id/reservas/:reservaId/rechazar", rechazarReservaConductor);
router.patch("/:id/reservas/:reservaId/estado", actualizarEstadoReservaConductor);
router.patch("/:id/operaciones/:operationId/estado", actualizarEstadoOperacionConductor);
router.patch("/:id/reservas/:reservaId/recoger", marcarRecogidoConductor);
router.get("/:id/disponibilidad", obtenerDisponibilidadConductor);
router.patch("/:id/disponibilidad", actualizarDisponibilidadConductor);
router.get("/:id/disponibilidad-externa", listarDisponibilidadExterna);
router.post("/:id/disponibilidad-externa", crearDisponibilidadExterna);
router.delete("/:id/disponibilidad-externa/:bloqueoId", cancelarDisponibilidadExterna);
router.get("/:id/rutas", listarReportesRutaConductor);
router.post("/:id/rutas", crearReporteRutaConductor);
router.patch("/:id/estado", actualizarEstadoConductor);
router.get("/:id/vehiculo", obtenerMiVehiculoConductor);
router.get("/:id/mantenimiento", listarMantenimientoConductor);
router.post("/:id/mantenimiento", crearMantenimientoConductor);
router.post("/:id/ubicacion", compartirUbicacionConductor);
router.get("/:id/clientes", listarClientesConductor);
router.post("/:id/registrar-viaje", registrarViajeConductor);

module.exports = router;
