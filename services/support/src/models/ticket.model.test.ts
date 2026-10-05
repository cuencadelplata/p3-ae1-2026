import { describe, it, expect } from 'vitest';
import { ticketRepository } from './ticket.model.js';

describe('TicketRepository', () => {
  it('debe crear un nuevo ticket correctamente', async () => {
    const ticket = await ticketRepository.crear('viaje-101', 'El conductor no llegó');

    expect(ticket).toBeDefined();
    expect(ticket.id).toBeDefined();
    expect(ticket.viajeId).toBe('viaje-101');
    expect(ticket.motivo).toBe('El conductor no llegó');
    expect(ticket.estado).toBe('ABIERTO');
    expect(ticket.fechaCreacion).toBeDefined();
  });

  it('debe obtener un ticket por su ID', async () => {
    const nuevo = await ticketRepository.crear('viaje-102', 'Carga incorrecta');
    const encontrado = await ticketRepository.obtenerPorId(nuevo.id);

    expect(encontrado).toEqual(nuevo);
  });

  it('debe retornar undefined al buscar un ID inexistente', async () => {
    const encontrado = await ticketRepository.obtenerPorId('id-inexistente-123');
    expect(encontrado).toBeUndefined();
  });

  it('debe actualizar el estado de un ticket existente', async () => {
    const ticket = await ticketRepository.crear('viaje-103', 'Objeto olvidado');
    const actualizado = await ticketRepository.actualizarEstado(ticket.id, 'EN_PROCESO');

    expect(actualizado).not.toBeNull();
    expect(actualizado?.estado).toBe('EN_PROCESO');

    const verificado = await ticketRepository.obtenerPorId(ticket.id);
    expect(verificado?.estado).toBe('EN_PROCESO');
  });

  it('debe retornar null al actualizar un ticket inexistente', async () => {
    const resultado = await ticketRepository.actualizarEstado('id-fake', 'RESUELTO');
    expect(resultado).toBeNull();
  });

  it('debe listar todos los tickets', async () => {
    const todos = await ticketRepository.listarTodos();
    expect(Array.isArray(todos)).toBe(true);
    expect(todos.length).toBeGreaterThan(0);
  });
});
