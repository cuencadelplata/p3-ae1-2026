import { Router } from 'express';
import { calificacionController } from '../controllers/calificacion.controller';

const router = Router();

/**
 * @route   POST /calificaciones
 * @desc    Crear una calificación para el conductor de un viaje completado
 * @access  Privado (requiere x-cliente-id en headers)
 */
router.post('/calificaciones', (req, res) => calificacionController.crearCalificacion(req, res));

/**
 * @route   GET /calificaciones/viaje/:viajeId
 * @desc    Obtener calificación de un viaje por su ID (Cache-Aside en Redis)
 * @access  Público / Autenticado
 */
router.get('/calificaciones/viaje/:viajeId', (req, res) =>
  calificacionController.obtenerCalificacionPorViajeId(req, res)
);

export default router;
