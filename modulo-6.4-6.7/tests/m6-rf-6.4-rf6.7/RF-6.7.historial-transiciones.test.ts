import { afterEach, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { crearViaje, startServices, stopServices, StubViajesApiClient } from './helpers.js';

describe('RF-6.7 - Fachada de historial', () => {
  const services: { api?: Server; simulator?: Server } = {};

  afterEach(() => {
    if (services.api && services.simulator) stopServices(services.api, services.simulator);
    services.api = undefined;
    services.simulator = undefined;
  });

  it('devuelve sin alteraciones el historial almacenado por Viajes', async () => {
    const viajesApi = new StubViajesApiClient();
    const running = await startServices(viajesApi);
    services.api = running.api;
    services.simulator = running.simulator;
    const viaje = await crearViaje(running.url, 'C-40');
    viajesApi.agregarTransicion(viaje.id, 'solicitado', 'asignado', 'Asignación del conductor');
    viajesApi.agregarTransicion(viaje.id, 'asignado', 'en curso', 'Inicio de viaje');

    const response = await fetch(`${running.url}/api/viajes/${viaje.id}/historial-transiciones`);
    const body = await response.json() as {
      historial: Array<{ from: string; to: string; detalle?: string }>;
    };

    expect(response.status).toBe(200);
    expect(body.historial).toHaveLength(2);
    expect(body.historial[0]).toMatchObject({
      from: 'solicitado',
      to: 'asignado',
      detalle: 'Asignación del conductor',
    });
    expect(body.historial[1]).toMatchObject({
      from: 'asignado',
      to: 'en curso',
      detalle: 'Inicio de viaje',
    });
  });

  it('propaga 404 cuando Viajes no conoce el viaje', async () => {
    const running = await startServices();
    services.api = running.api;
    services.simulator = running.simulator;

    const response = await fetch(`${running.url}/api/viajes/inexistente/historial-transiciones`);
    expect(response.status).toBe(404);
    expect((await response.json()).error).toBe('Viaje no encontrado');
  });
});
