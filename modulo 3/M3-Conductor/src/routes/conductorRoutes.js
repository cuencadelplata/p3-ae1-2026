const express = require("express");
const router = express.Router();
const {
  obtenerConductores,
  obtenerConductorPorId,
  crearConductor,
  obtenerHabilitado,
  obtenerDisponible,
  actualizarDisponible,
  actualizarHabilitado,
  obtenerEstadoConductor,
  obtenerHabilitadoConductor,
  obtenerDisponibleConductor
} = require("../controllers/conductoresController");
const {
  obtenerValoraciones,
  crearValoracion
} = require("../controllers/valoracionesController");
const {
  obtenerPendientes,
  obtenerNotificaciones,
  streamNotificaciones
} = require("../controllers/notificacionesController");

/**
 * Rutas de conductores
 */
router.get("/conductores", obtenerConductores);
// RF 3.1 / RF 3.3: habilitación (cache-aside Redis -> DB) y disponibilidad (solo Redis)
router.get("/conductores/:id/habilitado", obtenerHabilitado);
router.get("/conductores/:id/disponible", obtenerDisponible);
router.get("/conductores/:id/estado", obtenerEstadoConductor);
// Cambios de estado: emiten eventos asíncronos en RabbitMQ (RNF-07)
router.put("/conductores/:id/habilitado", actualizarHabilitado);
router.put("/conductores/:id/disponible", actualizarDisponible);
router.get("/conductores/:id", obtenerConductorPorId);
router.post("/conductores", crearConductor);
router.post("/conductores/", crearConductor);
router.post("/conductores/create", crearConductor);

/**
 * Rutas de estado, habilitación y disponibilidad de conductor (estructura combinada)
 */
router.get("/conductor/:id/estado", obtenerEstadoConductor);
router.get("/conductor/:id/habilitado", obtenerHabilitadoConductor);
router.get("/conductor/:id/disponible", obtenerDisponibleConductor);

/**
 * Rutas de valoraciones
 */
router.get("/conductor/valoraciones", obtenerValoraciones);
router.post("/conductor/valoraciones", crearValoracion);

router.get("/valoraciones/pendientes", obtenerPendientes);
router.get("/valoraciones/notificaciones", obtenerNotificaciones);
router.get("/valoraciones/notificaciones/stream", streamNotificaciones);

module.exports = router;
