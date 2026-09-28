import { afterEach, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { startServices, stopServices } from './helpers.js';

describe('RF-6.5 - Cancelación por cliente', () => {
  const services: { api?: Server } = {};

  afterEach(() => {
    if (services.api) stopServices(services.api);
  });

  it('cancela con motivo, estado y cargo consultado externamente', async () => {
    const viaje = { id: 'V-200', clienteId: 'C-10', conductorId: 'D-10', estado: 'SOLICITADO' };
    const running = await startServices(new Map([[viaje.id, viaje]]));
    services.api = running.api;

    const response = await fetch(`${running.url}/api/viajes/V-200/cancelacion-cliente`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ motivo: 'Cambio de planes' }),
    });
    const body = await response.json() as { viaje: typeof viaje };

    expect(response.status).toBe(200);
    expect(body.viaje.estado).toBe('CANCELADO');
    expect(running.events.messages[0]).toMatchObject({ routingKey: 'cancelacion_cliente' });
  });

  it('rechaza cancelar un viaje ya cancelado', async () => {
    const viaje = { id: 'V-201', clienteId: 'C-11', conductorId: 'D-11', estado: 'CANCELADO' };
    const running = await startServices(new Map([[viaje.id, viaje]]));
    services.api = running.api;

    const response = await fetch(`${running.url}/api/viajes/V-201/cancelacion-cliente`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ motivo: 'Otro motivo' }),
    });

    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain('ya cancelado');
  });
});