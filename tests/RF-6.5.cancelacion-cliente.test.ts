import { describe, expect, it } from 'vitest';
import { Viaje } from '../src/Viaje.js';

describe('RF-6.5 - Cancelación por cliente', () => {
  it('debe cancelar el viaje con motivo, estado y cargo', () => {
    const viaje = new Viaje({
      id: 'V-200',
      clienteId: 'C-10',
      conductorId: 'D-10',
      estado: 'pendiente',
      tarifaBase: 150,
      tarifaPorKm: 90,
      tarifaPorMinuto: 30,
      inicio: new Date('2026-09-01T11:00:00Z'),
    });

    viaje.cancelarPorCliente({
      motivo: 'Cambio de planes',
      cargo: 200,
    });

    expect(viaje.estado).toBe('cancelado');
    expect(viaje.motivoCancelacion).toBe('Cambio de planes');
    expect(viaje.cargoCancelacion).toBe(200);
    expect(viaje.historialTransiciones.at(-1)?.to).toBe('cancelado');
    expect(viaje.historialTransiciones.at(-1)?.detalle).toContain('Cancelación por cliente');
  });

  it('no debe permitir cancelar un viaje ya cancelado', () => {
    const viaje = new Viaje({
      id: 'V-201',
      clienteId: 'C-11',
      conductorId: 'D-11',
      estado: 'cancelado',
      tarifaBase: 150,
      tarifaPorKm: 90,
      tarifaPorMinuto: 30,
      inicio: new Date('2026-09-01T11:05:00Z'),
      motivoCancelacion: 'Cliente no respondió',
      cargoCancelacion: 0,
    });

    expect(() => {
      viaje.cancelarPorCliente({ motivo: 'Otro motivo' });
    }).toThrow('No se puede cancelar un viaje ya cancelado');
  });
});
