import { afterEach, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { startServices, stopServices } from './helpers.js';

describe('RF-6.6 - Cancelación por conductor', () => {
  const services: { api?: Server } = {};

  afterEach(() => {
    if (services.api) stopServices(services.api);
  });

  it('retorna al cliente al proceso de despacho y registra el motivo del conductor', async () => {
    const viaje = { id: 'V-300', clienteId: 'C-30', conductorId: 'D-30', estado: 'CONDUCTOR_EN_CAMINO' };
    const running = await startServices(new Map([[viaje.id, viaje]]));
    services.api = running.api;

    const response = await fetch(`${running.url}/api/viajes/V-300/cancelacion-conductor`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ motivo: 'Se me averió el vehículo' }),
    });
    const body = await response.json() as { viaje: typeof viaje };

    expect(response.status).toBe(200);
    expect(body.viaje.estado).toBe('CANCELADO');
    expect(running.events.messages[0]).toMatchObject({ routingKey: 'despacho.reabrir' });
  });

  it('rechaza cancelar un viaje ya finalizado', async () => {
    const viaje = { id: 'V-301', clienteId: 'C-31', conductorId: 'D-31', estado: 'COMPLETADO' };
    const running = await startServices(new Map([[viaje.id, viaje]]));
    services.api = running.api;

    const response = await fetch(`${running.url}/api/viajes/V-301/cancelacion-conductor`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ motivo: 'No puedo continuar' }),
    });

    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain('ya finalizado');
  });
});
