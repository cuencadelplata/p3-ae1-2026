const express = require("express");
const router = express.Router();
const {
  obtenerConductores,
  obtenerConductorPorId,
  crearConductor,
  obtenerHabilitado,
  obtenerDisponible,
  actualizarDisponible,
  actualizarHabilitado
} = require("../controllers/conductoresController");
const {
  obtenerValoraciones,
  crearValoracion
} = require("../controllers/valoracionesController");

/**
 * Rutas de conductores
 */
router.get("/conductores", obtenerConductores);
router.get("/conductores/:id/habilitado", obtenerHabilitado);
router.get("/conductores/:id/disponible", obtenerDisponible);
// Cambios de estado: emiten eventos asíncronos en RabbitMQ (RNF-07)
router.put("/conductores/:id/habilitado", actualizarHabilitado);
router.put("/conductores/:id/disponible", actualizarDisponible);
router.get("/conductores/:id", obtenerConductorPorId);
router.post("/conductores", crearConductor);
router.post("/conductores/", crearConductor);
router.post("/conductores/create", crearConductor);

/**
 * Rutas de valoraciones
 */
router.get("/conductor/valoraciones", obtenerValoraciones);
router.post("/conductor/valoraciones", crearValoracion);

module.exports = router;
