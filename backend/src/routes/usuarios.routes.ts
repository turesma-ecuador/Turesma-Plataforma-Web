export {};

const express = require("express");
const { verifyToken, requireRole, optionalAuth } = require("../middleware/auth.middleware");
const {
  crearUsuario,
  listarUsuarios,
  listarVehiculosCliente,
  listarTarifasCliente,
  recomendarVehiculo,
  verDisponibilidadVehiculoCliente,
  listarMisReservas,
  cancelarMiReserva,
  reprogramarMiReserva,
  calificarMiReserva,
  seguimientoMiReserva,
  eliminarMiCuenta,
} = require("../controllers/usuarios.controller");
const { crearPagoReserva, listarPagosDeReserva, descargarReciboPago, descargarProformaReserva, descargarFactura, descargarOrdenCompra, crearPagoPayphone, confirmarPagoPayphone } = require("../controllers/pagos.controller");
const { uploadComprobantePago, serveComprobante } = require("../controllers/uploads.controller");
const { enviarVerificacion, miVerificacion, subirDocumentoVerificacion } = require("../controllers/verificacion.controller");
const { listarGaleriaPublica } = require("../controllers/galeria.controller");
const { listarViajesPublicos, reservarViajePublicado } = require("../controllers/viajes.controller");
const { getPublicHomeShowcaseImages } = require("../controllers/home-showcase.controller");
const { getPublicHomeCityShowcase } = require("../controllers/home-city-showcase.controller");
const {
  crearSolicitudCambioDestino,
  listarSolicitudesCambioDestinoCliente,
  aceptarPropuestaCambioDestino,
  rechazarPropuestaCambioDestino,
} = require("../controllers/cambios-destino.controller");

const router = express.Router();

// Rutas públicas (sin autenticación)
router.get("/vehiculos", listarVehiculosCliente);
router.get("/tarifas", listarTarifasCliente);
router.post("/vehiculos/recomendacion", verifyToken, recomendarVehiculo);
router.get("/vehiculos/:id/disponibilidad", verDisponibilidadVehiculoCliente);
router.get("/galeria", listarGaleriaPublica);
router.get("/home-showcase-images", getPublicHomeShowcaseImages);
router.get("/home-city-showcase", getPublicHomeCityShowcase);
router.get("/viajes", listarViajesPublicos);

// Rutas protegidas por token
router.get("/mis-reservas", verifyToken, listarMisReservas);
router.post("/viajes/:id/reservar", verifyToken, reservarViajePublicado);
router.patch("/mis-reservas/:id/cancelar", verifyToken, cancelarMiReserva);
router.patch("/mis-reservas/:id/reprogramar", verifyToken, reprogramarMiReserva);
router.get("/mis-reservas/:id/cambio-destino", verifyToken, listarSolicitudesCambioDestinoCliente);
router.post("/mis-reservas/:id/cambio-destino", verifyToken, crearSolicitudCambioDestino);
router.post("/mis-reservas/cambio-destino/:solicitudId/aceptar", verifyToken, aceptarPropuestaCambioDestino);
router.post("/mis-reservas/cambio-destino/:solicitudId/rechazar", verifyToken, rechazarPropuestaCambioDestino);
router.patch("/mis-reservas/:id/calificar", verifyToken, calificarMiReserva);
router.get("/mis-reservas/:id/ubicacion", verifyToken, seguimientoMiReserva);
router.post("/mis-reservas/:id/pagos", verifyToken, crearPagoReserva);
router.get("/mis-reservas/:id/pagos", verifyToken, listarPagosDeReserva);
router.get("/mis-reservas/:id/pagos/:pagoId/recibo", verifyToken, descargarReciboPago);
router.get("/mis-reservas/:id/proforma", verifyToken, descargarProformaReserva);
router.get("/mis-reservas/:id/factura", verifyToken, descargarFactura);
router.get("/mis-reservas/:id/orden-compra", verifyToken, descargarOrdenCompra);
router.post("/mis-reservas/:id/pagos/payphone", verifyToken, crearPagoPayphone);
router.post("/mis-reservas/:id/pagos/payphone/confirmar", verifyToken, confirmarPagoPayphone);
router.post("/uploads/comprobante-pago", verifyToken, uploadComprobantePago);
router.get("/comprobantes/:filename", optionalAuth, serveComprobante);
router.get("/verificacion", verifyToken, miVerificacion);
router.post("/verificacion", verifyToken, enviarVerificacion);
router.post("/verificacion/documento", verifyToken, subirDocumentoVerificacion);
router.delete("/mi-cuenta", verifyToken, eliminarMiCuenta);

router.get("/", verifyToken, requireRole("admin"), listarUsuarios);
router.post("/", verifyToken, requireRole("admin"), crearUsuario);

module.exports = router;
