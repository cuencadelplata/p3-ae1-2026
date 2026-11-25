import { Request, Response } from 'express';
import { invalidToken } from '../errors/support-error.js';
import {
  leerActor,
  leerCambioDeEstado,
  leerConsultaDeTickets,
  leerIdempotencyKey,
  leerMensaje,
  leerNuevoTicket,
} from '../http/ticket-requests.js';
import { TicketService } from '../services/ticket.service.js';

// Quién hace el pedido: el usuario autenticado por M1 si la autenticación
// está habilitada; si no, lo que el cliente declara en X-Actor-Id.
function actorDelPedido(req: Request, res: Response): string | null {
  return typeof res.locals.actor === 'string' ? res.locals.actor : leerActor(req.get('X-Actor-Id'));
}

export interface SupportControllerDeps {
  ticketService: TicketService;
}

// Los errores se lanzan como SupportError y los convierte supportErrorHandler.
export function createSupportController({ ticketService }: SupportControllerDeps) {
  async function listar(req: Request, res: Response, autor?: string) {
    const consulta = leerConsultaDeTickets(req.query);
    const { tickets, siguienteCursor } = await ticketService.listarTickets({ ...consulta, autor });
    if (siguienteCursor) res.setHeader('X-Next-Cursor', siguienteCursor);
    res.json(tickets);
  }

  return {

    // Endpoint: POST /tickets
    async crearTicket(req: Request, res: Response) {
      const { tripId, motivo } = leerNuevoTicket(req.body);
      const actor = actorDelPedido(req, res);
      const idempotencyKey = leerIdempotencyKey(req.get('Idempotency-Key'));

      const { ticket, creado } = await ticketService.crearTicket(tripId, motivo, { actor, idempotencyKey });

      // 200 cuando la Idempotency-Key ya había creado este ticket.
      res.status(creado ? 201 : 200).json(ticket);
    },

    // Endpoint: GET /tickets/:id
    async obtenerTicket(req: Request, res: Response) {
      const id = req.params.id as string;
      const ticket = await ticketService.obtenerTicket(id);

      res.json(ticket);
    },

    // Endpoint: PATCH /tickets/:id/estado
    async actualizarEstado(req: Request, res: Response) {
      const id = req.params.id as string;
      const { estado, motivo, expectedVersion, registrarRespuesta } = leerCambioDeEstado(req.body);
      const actor = actorDelPedido(req, res);

      const ticketActualizado = await ticketService.actualizarEstado(id, estado, { actor, motivo, expectedVersion }, registrarRespuesta);

      res.json(ticketActualizado);
    },

    // Endpoint: GET /tickets/:id/historial
    async obtenerHistorial(req: Request, res: Response) {
      const id = req.params.id as string;
      const historial = await ticketService.obtenerHistorial(id);

      res.json(historial);
    },

    async enviarMensaje(req: Request, res: Response) {
      const actor = res.locals.actor;
      if (typeof actor !== 'string') throw invalidToken();
      const { texto, expectedVersion } = leerMensaje(req.body);
      const ticket = await ticketService.enviarMensaje(String(req.params.id), texto, actor, expectedVersion);
      res.status(201).json(ticket);
    },

    // Endpoint: GET /tickets?tripId=&estado=&limit=&cursor=
    async listarTodos(req: Request, res: Response) {
      await listar(req, res);
    },

    async listarPropios(req: Request, res: Response) {
      const autor = res.locals.actor;
      if (typeof autor !== 'string') throw invalidToken();
      await listar(req, res, autor);
    },
  };
}
