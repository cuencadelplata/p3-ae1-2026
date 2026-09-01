import { describe, expect, it } from 'vitest';
import { Viaje } from '../src/Viaje.js';

describe('RF-6.4 - Finalización del viaje', () => {
  it('debe registrar tiempo, distancia y calcular el costo de la carrera al finalizar', () => {
    const viaje = new Viaje({
      id: 'V-100',
      clienteId: 'C-1',
      conductorId: 'D-1',
      estado: 'en_curso',
      tarifaBase: 150,
      tarifaPorKm: 80,
      tarifaPorMinuto: 25,
      inicio: new Date('2026-09-01T10:00:00Z'),
    });

    viaje.finalizar({
      tiempoMinutos: 42,
      distanciaKm: 18.5,
      horaFin: new Date('2026-09-01T10:42:00Z'),
      metodoPago: 'tarjeta',
    });

    expect(viaje.estado).toBe('finalizado');
    expect(viaje.tiempoMinutos).toBe(42);
    expect(viaje.distanciaKm).toBe(18.5);
    expect(viaje.horaFin).toEqual(new Date('2026-09-01T10:42:00Z'));
    expect(viaje.metodoPago).toBe('tarjeta');
    expect(viaje.total).toBe(150 + 18.5 * 80 + 42 * 25);
    expect(viaje.historialTransiciones.at(-1)?.to).toBe('finalizado');
  });

  it('no debe permitir finalizar un viaje ya finalizado', () => {
    const viaje = new Viaje({
      id: 'V-101',
      clienteId: 'C-2',
      conductorId: 'D-2',
      estado: 'finalizado',
      tarifaBase: 100,
      tarifaPorKm: 70,
      tarifaPorMinuto: 20,
      inicio: new Date('2026-09-01T08:00:00Z'),
      horaFin: new Date('2026-09-01T08:20:00Z'),
      tiempoMinutos: 20,
      distanciaKm: 10,
      total: 100 + 10 * 70 + 20 * 20,
    });

    expect(() => {
      viaje.finalizar({
        tiempoMinutos: 30,
        distanciaKm: 12,
        horaFin: new Date('2026-09-01T08:30:00Z'),
        metodoPago: 'efectivo',
      });
    }).toThrow('No se puede finalizar un viaje ya finalizado');
  });
});
