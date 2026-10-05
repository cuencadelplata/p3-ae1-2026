import { afterEach, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { Viaje } from '../src/Viaje.js';
import { startServices, stopServices } from './helpers.js';

describe('Rutas de cancelación retiradas', () => {
  const services: { api?: Server; simulator?: Server } = {};

  afterEach(() => {
    if (services.api && services.simulator) stopServices(services.api, services.simulator);
  });

  it.each(['cancelacion-cliente', 'cancelacion-conductor'])('responde 404 para %s', async (route) => {
    const viaje = new Viaje({
      id: `V-${route}`,
      clienteId: 'C-1',
      conductorId: 'D-1',
      estado: 'en curso',
      tarifaBase: 0,
      tarifaPorKm: 0,
      tarifaPorMinuto: 0,
      inicio: new Date('2026-09-01T10:00:00Z'),
    });
    const running = await startServices(new Map([[viaje.id, viaje]]));
    services.api = running.api;
    services.simulator = running.simulator;

    const response = await fetch(`${running.url}/api/viajes/${viaje.id}/${route}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ motivo: 'prueba' }),
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Ruta no encontrada' });
  });
});
