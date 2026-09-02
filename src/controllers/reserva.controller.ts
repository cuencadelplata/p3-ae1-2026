import type { RequestHandler } from 'express';

import {
  parseActualizarReserva,
  parseCrearReserva,
  parseReservaId,
} from '../schemas/reserva.schema.js';
import type { ReservaService } from '../services/reserva.service.js';

export interface ReservaController {
  crear: RequestHandler;
  listar: RequestHandler;
  obtenerPorId: RequestHandler;
  actualizar: RequestHandler;
  cancelar: RequestHandler;
}

export const createReservaController = (service: ReservaService): ReservaController => ({
  crear: async (request, response) => {
    const reserva = await service.crear(parseCrearReserva(request.body));
    response.status(201).json(reserva);
  },
  listar: async (_request, response) => {
    response.status(200).json({ reservas: await service.listar() });
  },
  obtenerPorId: async (request, response) => {
    response.status(200).json(await service.obtenerPorId(parseReservaId(request.params.id)));
  },
  actualizar: async (request, response) => {
    response
      .status(200)
      .json(
        await service.actualizar(
          parseReservaId(request.params.id),
          parseActualizarReserva(request.body),
        ),
      );
  },
  cancelar: async (request, response) => {
    response.status(200).json(await service.cancelar(parseReservaId(request.params.id)));
  },
});
