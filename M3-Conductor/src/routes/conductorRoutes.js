const express = require("express");
const router = express.Router();
const {
  obtenerConductores,
  obtenerConductorPorId,
  crearConductor,
  obtenerHabilitado,
  obtenerDisponible
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
