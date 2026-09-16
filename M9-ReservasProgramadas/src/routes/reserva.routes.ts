import { Router } from 'express';

import { createReservaController } from '../controllers/reserva.controller.js';
import type { ReservaService } from '../services/reserva.service.js';

export const createReservaRouter = (service: ReservaService): Router => {
  const router = Router();
  const controller = createReservaController(service);

  router.post('/', controller.crear);
  router.get('/', controller.listar);
  router.get('/:id', controller.obtenerPorId);
  router.patch('/:id', controller.actualizar);
  router.delete('/:id', controller.cancelar);

  return router;
};
