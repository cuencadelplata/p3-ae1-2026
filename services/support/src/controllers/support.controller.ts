import { Request, Response } from 'express';
import { TicketStatus } from '../models/ticket.model.js';
import { RabbitMQConsumer } from '../rabbitmq/consumer.js';
import { TicketService } from '../services/ticket.service.js';

export interface SupportControllerDeps {
  ticketService: TicketService;
}

export function createSupportController({ ticketService }: SupportControllerDeps) {
  return {

    // Endpoint: POST /tickets
    async crearTicket(req: Request, res: Response) {
      const { viajeId, motivo } = req.body;

      // Validación básica
      if (!viajeId || !motivo) {
        res.status(400).json({ error: 'viajeId y motivo son requeridos' });
        return;
      }

      const nuevoTicket = await ticketService.crearTicket(viajeId, motivo);

      res.status(201).json(nuevoTicket);
    },

    // Endpoint: GET /tickets/:id
    async obtenerTicket(req: Request, res: Response) {
      const id = req.params.id as string;
      const ticket = await ticketService.obtenerTicket(id);

      if (!ticket) {
        res.status(404).json({ error: 'Ticket no encontrado' });
        return;
      }

      res.json(ticket);
    },

    // Endpoint: PATCH /tickets/:id/estado
    async actualizarEstado(req: Request, res: Response) {
      const id = req.params.id as string;
      const { estado } = req.body;

      // Validar que el estado sea correcto
      const estadosValidos: TicketStatus[] = ['ABIERTO', 'EN_PROCESO', 'RESUELTO'];
      if (!estadosValidos.includes(estado)) {
        res.status(400).json({ error: 'Estado inválido. Valores permitidos: ABIERTO, EN_PROCESO, RESUELTO' });
        return;
      }

      const ticketActualizado = await ticketService.actualizarEstado(id, estado as TicketStatus);
      if (!ticketActualizado) {
        res.status(404).json({ error: 'Ticket no encontrado' });
        return;
      }

      res.json(ticketActualizado);
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
