import { describe, expect, it } from 'vitest';
import { applyDriverCancellation, type SimulatedDispatchRequest } from '../../../simulator/rf-6.5-6.6/m6-rf6.5-rf6.6/m5-dispatch-simulator.js';

describe('Simulador de M5 - reapertura del despacho', () => {
  it('libera la solicitud y excluye al conductor que canceló', () => {
    const request: SimulatedDispatchRequest = {
      viajeId: 'viaje-123',
      clienteId: 'cliente-123',
      status: 'ASSIGNED',
      assignedDriverId: 'conductor-123',
      excludedDriverIds: [],
    };
    const requests = new Map([[request.viajeId, request]]);

    const applied = applyDriverCancellation(requests, {
      viajeId: 'viaje-123',
      clienteId: 'cliente-123',
      conductorId: 'conductor-123',
      motivo: 'Falla mecánica',
      evento: 'cancelacion_conductor',
      timestamp: new Date().toISOString(),
    });

    expect(applied).toBe(true);
    expect(requests.get('viaje-123')).toMatchObject({
      status: 'SEARCHING',
      assignedDriverId: null,
      excludedDriverIds: ['conductor-123'],
    });
  });
});
