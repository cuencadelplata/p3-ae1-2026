import { Request, Response } from 'express';
import { ticketRepository, TicketStatus } from '../models/ticket.model.js';

export class SupportController {
  
  // Endpoint: POST /tickets
  static crearTicket(req: Request, res: Response) {
    const { viajeId, motivo } = req.body;

    // Validación básica
    if (!viajeId || !motivo) {
      // En Express 5 no necesitamos retornar explícitamente res.status(...), 
      // pero es buena práctica hacer un return temprano.
      res.status(400).json({ error: 'viajeId y motivo son requeridos' });
      return;
    }

    const nuevoTicket = ticketRepository.crear(viajeId, motivo);
    res.status(201).json(nuevoTicket);
  }

  // Endpoint: GET /tickets/:id
  static obtenerTicket(req: Request, res: Response) {
    const id = req.params.id as string;
    const ticket = ticketRepository.obtenerPorId(id);

    if (!ticket) {
      res.status(404).json({ error: 'Ticket no encontrado' });
      return;
    }

    res.json(ticket);
  }

  // Endpoint: PATCH /tickets/:id/estado
  static actualizarEstado(req: Request, res: Response) {
    const id = req.params.id as string;
    const { estado } = req.body;

    // Validar que el estado sea correcto
    const estadosValidos: TicketStatus[] = ['ABIERTO', 'EN_PROCESO', 'RESUELTO'];
    if (!estadosValidos.includes(estado)) {
      res.status(400).json({ error: 'Estado inválido. Valores permitidos: ABIERTO, EN_PROCESO, RESUELTO' });
      return;
    }

    const ticketActualizado = ticketRepository.actualizarEstado(id, estado as TicketStatus);
    if (!ticketActualizado) {
      res.status(404).json({ error: 'Ticket no encontrado' });
      return;
    }

    res.json(ticketActualizado);
  }

  // Endpoint: GET /tickets (solo para revisión y pruebas)
  static listarTodos(req: Request, res: Response) {
    const tickets = ticketRepository.listarTodos();
    res.json(tickets);
  }
}
