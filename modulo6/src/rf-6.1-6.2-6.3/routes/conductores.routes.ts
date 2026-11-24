import { Router } from 'express';
import { obtenerViajesDeConductor } from '../controllers/viajes.controller.js';

const router = Router();

router.get('/:conductorId/viajes', obtenerViajesDeConductor);

export default router;