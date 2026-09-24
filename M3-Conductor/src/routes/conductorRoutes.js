const express = require("express");
const router = express.Router();
const {
  obtenerConductores,
  obtenerConductorPorId,
  crearConductor,
  obtenerEstadoConductor,
  obtenerHabilitadoConductor,
  obtenerDisponibleConductor
} = require("../controllers/conductoresController");
const {
  obtenerValoraciones,
  crearValoracion
} = require("../controllers/valoracionesController");

/**
 * Rutas de conductores
 */
router.get("/conductores", obtenerConductores);
router.get("/conductores/:id", obtenerConductorPorId);
router.post("/conductores", crearConductor);
router.post("/conductores/", crearConductor);
router.post("/conductores/create", crearConductor);

/**
 * Rutas de estado, habilitación y disponibilidad de conductor
 */
router.get("/conductor/:id/estado", obtenerEstadoConductor);
router.get("/conductor/:id/habilitado", obtenerHabilitadoConductor);
router.get("/conductor/:id/disponible", obtenerDisponibleConductor);

router.get("/conductores/:id/estado", obtenerEstadoConductor);
router.get("/conductores/:id/habilitado", obtenerHabilitadoConductor);
router.get("/conductores/:id/disponible", obtenerDisponibleConductor);

/**
 * Rutas de valoraciones
 */
router.get("/conductor/valoraciones", obtenerValoraciones);
router.post("/conductor/valoraciones", crearValoracion);

module.exports = router;
