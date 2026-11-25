const express = require("express");
const router = express.Router();
const {
  obtenerConductores,
  obtenerPendientesDeHabilitacion,
  obtenerConductorPorId,
  enviarAltaAM1,
  asegurarPerfilConductor,
  crearConductor,
  actualizarTipoVehiculo,
  obtenerHabilitado,
  obtenerDisponible,
  actualizarDisponible,
  actualizarHabilitado,
  obtenerEstadoConductor,
  obtenerHabilitadoConductor,
  obtenerDisponibleConductor
} = require("../controllers/conductoresController");
const { validarIdentidad } = require("../infraestructure/m1Client");
const {
  obtenerValoraciones,
  crearValoracion
} = require("../controllers/valoracionesController");
const {
  obtenerPendientes,
  obtenerNotificaciones,
  streamNotificaciones,
  demoViajeFinalizado
} = require("../controllers/notificacionesController");

/**
 * Rutas de conductores
 */
function requerirRol(rol) {
  return async (req, res, next) => {
    const token = req.get("authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1];
    if (!token) return res.status(401).json({ error: "Iniciá sesión para continuar." });

    try {
      const identidad = await validarIdentidad(token);
      if (identidad.role !== rol) return res.status(403).json({ error: "Tu cuenta no tiene permiso para esta operación." });
      req.identidadM1 = identidad;
      return next();
    } catch (error) {
      return res.status(error.status || 503).json({ error: error.message });
    }
  };
}

const operador = requerirRol("OPERADOR");
router.get("/conductores", obtenerConductores);
router.get("/conductores/pendientes", operador, obtenerPendientesDeHabilitacion);
router.post("/conductores/me", requerirRol("CONDUCTOR"), asegurarPerfilConductor);
// RF 3.1 / RF 3.3: habilitación (cache-aside Redis -> DB) y disponibilidad (solo Redis)
router.get("/conductores/:id/habilitado", obtenerHabilitado);
router.get("/conductores/:id/disponible", obtenerDisponible);
router.get("/conductores/:id/estado", obtenerEstadoConductor);
// Cambios de estado: emiten eventos asíncronos en RabbitMQ (RNF-07)
router.put("/conductores/:id/habilitado", operador, actualizarHabilitado);
router.post("/conductores/:id/enviar-alta", requerirRol("CONDUCTOR"), enviarAltaAM1);
router.put("/conductores/:id/disponible", actualizarDisponible);
router.get("/conductores/:id", obtenerConductorPorId);
// Corrección del tipo de vehículo elegido en el alta (front alta-conductor)
router.patch("/conductores/:id", actualizarTipoVehiculo);
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
router.post("/valoraciones/demo-viaje-finalizado", demoViajeFinalizado);

module.exports = router;
