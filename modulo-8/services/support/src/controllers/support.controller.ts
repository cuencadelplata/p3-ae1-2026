import { Request, Response } from 'express';
import { leerActor, leerCambioDeEstado, leerIdempotencyKey, leerNuevoTicket } from '../http/ticket-requests.js';
import { RabbitMQConsumer } from '../rabbitmq/consumer.js';
import { TicketService } from '../services/ticket.service.js';

export interface SupportControllerDeps {
  ticketService: TicketService;
}

// Los errores se lanzan como SupportError y los convierte supportErrorHandler.
export function createSupportController({ ticketService }: SupportControllerDeps) {
  return {

    // Endpoint: POST /tickets
    async crearTicket(req: Request, res: Response) {
      const { tripId, motivo } = leerNuevoTicket(req.body);
      const actor = leerActor(req.get('X-Actor-Id'));
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
      const { estado, motivo, expectedVersion } = leerCambioDeEstado(req.body);
      const actor = leerActor(req.get('X-Actor-Id'));

      const ticketActualizado = await ticketService.actualizarEstado(id, estado, { actor, motivo, expectedVersion });

      res.json(ticketActualizado);
    },

    // Endpoint: GET /tickets/:id/historial
    async obtenerHistorial(req: Request, res: Response) {
      const id = req.params.id as string;
      const historial = await ticketService.obtenerHistorial(id);

      res.json(historial);
    },

    // Endpoint: GET /tickets (solo para revisión y pruebas)
    async listarTodos(req: Request, res: Response) {
      const tickets = await ticketService.listarTickets();
      res.json(tickets);
    },
  };
}

// Endpoint: POST /events/publish (RF-8.6, heredado de AE1)
// Permite publicar eventos en RabbitMQ (ej: viaje.completado, viaje.asignado, ticket.creado)
// Permite incluir 'count' para emitir ráfagas de mensajes y observar la actividad en el panel de RabbitMQ.
export async function publicarEvento(req: Request, res: Response) {
  const { routingKey, payload, count } = req.body;

  if (!routingKey || !payload) {
    res.status(400).json({ error: 'routingKey y payload son requeridos' });
    return;
  }

  const cantidad = Math.max(1, Math.min(Number(count) || 1, 50));
  let exitosos = 0;

  for (let i = 0; i < cantidad; i++) {
    const ok = await RabbitMQConsumer.publishEvent(routingKey, {
      ...payload,
      _secuencia: i + 1,
      _timestamp: new Date().toISOString()
    });
    if (ok) exitosos++;
  }

  res.status(200).json({
    mensaje: 'Eventos enviados a RabbitMQ',
    routingKey,
    solicitados: cantidad,
    enviadosExitosamente: exitosos
  });
}
