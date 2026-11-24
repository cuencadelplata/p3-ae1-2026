import { Router } from 'express';
import { obtenerViajesDeCliente } from '../controllers/viajes.controller.js';

const router = Router();

router.get('/:clienteId/viajes', obtenerViajesDeCliente);

export default router;
