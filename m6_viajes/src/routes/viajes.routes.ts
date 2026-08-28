import { Router } from 'express';
import { solicitarViaje, registrarArribo } from '../controllers/viajes.controller.js';

const router = Router();

//endpoint para solicitar un viaje
router.post('/', solicitarViaje);

//endpoint para registrar que el conductor llegó 
router.put('/:id/arribo', registrarArribo);

export default router;