import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { forbidden } from '../errors/support-error.js';
import type { AuthenticatedUser } from '../integrations/m1-identity.js';
import type { TicketService } from '../services/ticket.service.js';
import { actorDeM1 } from './authentication.js';

// Permisos de /tickets cuando la identidad la valida M1 (sin M1 no se aplican).
//
// - Crear un ticket: cualquier usuario autenticado (cliente, conductor u operador).
// - Listar todos y cambiar estados: sólo el Operador, el rol de soporte del escenario.
// - Listar tickets propios: el repositorio filtra por el autor autenticado.
// - Ver un ticket y su historial: el Operador o quien lo creó. El autor queda
//   en la entrada inicial del historial como m1:<userId>.
export type PermisoDeTicket = 'autenticado' | 'operador' | 'operadorOCreador';

function usuarioDe(res: Response): AuthenticatedUser | undefined {
  return res.locals.usuarioAutenticado as AuthenticatedUser | undefined;
}

export function autorizarTicket(permiso: PermisoDeTicket, ticketService: TicketService): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    const usuario = usuarioDe(res);
    if (!usuario || permiso === 'autenticado' || usuario.role === 'OPERADOR') {
      next();
      return;
    }
    if (permiso === 'operador') {
      throw forbidden();
    }

    // Un ticket inexistente sigue respondiendo 404 (lo informa obtenerHistorial).
    const historial = await ticketService.obtenerHistorial(String(req.params.id));
    const autor = historial.find((entrada) => entrada.estadoAnterior === null)?.cambiadoPor;
    if (autor !== actorDeM1(usuario.userId)) {
      throw forbidden();
    }
    next();
  };
}
