import type { RequestHandler, Response } from 'express';
import { AppError } from '../errors/app.error.js';
const actor = (response: Response): string => {
  const id: unknown = response.locals.clientId;
  if (typeof id !== 'string')
    throw new AppError(401, 'TOKEN_REQUERIDO', 'Se requiere autenticacion.');
  return id;
};

import {
  parseActualizarReserva,
  parseCrearReserva,
  parsePaginacion,
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
    const clientId = actor(response);
    if (request.body?.clienteId !== undefined && request.body.clienteId !== clientId)
      throw new AppError(403, 'CLIENTE_NO_PERMITIDO', 'No puede crear reservas de otro cliente.');
    const reserva = await service.crear(
      parseCrearReserva({ ...request.body, clienteId: clientId }),
    );
    response.status(201).json(reserva);
  },
  listar: async (request, response) => {
    const { page, pageSize } = parsePaginacion(request.query);
    response.status(200).json({
      reservas: await service.listarPaginado(page, pageSize, actor(response)),
      page,
      pageSize,
    });
  },
  obtenerPorId: async (request, response) => {
    response
      .status(200)
      .json(await service.obtenerPorId(parseReservaId(request.params.id), actor(response)));
  },
  actualizar: async (request, response) => {
    response
      .status(200)
      .json(
        await service.actualizar(
          parseReservaId(request.params.id),
          parseActualizarReserva(request.body),
          actor(response),
        ),
      );
  },
  cancelar: async (request, response) => {
    response
      .status(200)
      .json(await service.cancelar(parseReservaId(request.params.id), actor(response)));
  },
});
