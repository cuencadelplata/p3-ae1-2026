import { afterEach, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { Viaje } from '../src/Viaje.js';
import { startServices, stopServices } from './helpers.js';

describe('RF-6.5 - Cancelación por cliente', () => {
  const services: { api?: Server; simulator?: Server } = {};

  afterEach(() => {
    if (services.api && services.simulator) stopServices(services.api, services.simulator);
  });

  it('cancela con motivo, estado y cargo consultado externamente', async () => {
    const viaje = new Viaje({ id: 'V-200', clienteId: 'C-10', conductorId: 'D-10', estado: 'asignado', tarifaBase: 0, tarifaPorKm: 0, tarifaPorMinuto: 0, inicio: new Date('2026-09-01T11:00:00Z') });
    const running = await startServices(new Map([[viaje.id, viaje]]));
    services.api = running.api;
    services.simulator = running.simulator;

    const response = await fetch(`${running.url}/api/viajes/V-200/cancelacion-cliente`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ motivo: 'Cambio de planes' }),
    });
    const body = await response.json() as { viaje: Viaje };

    expect(response.status).toBe(200);
    expect(body.viaje.estado).toBe('cancelado');
    expect(body.viaje.motivoCancelacion).toBe('Cambio de planes');
    expect(body.viaje.cargoCancelacion).toBe(200);
    expect(body.viaje.historialTransiciones.at(-1)?.detalle).toContain('Cancelación por cliente');
  });

  it('rechaza cancelar un viaje ya cancelado', async () => {
    const viaje = new Viaje({ id: 'V-201', clienteId: 'C-11', conductorId: 'D-11', estado: 'cancelado', tarifaBase: 0, tarifaPorKm: 0, tarifaPorMinuto: 0, inicio: new Date('2026-09-01T11:05:00Z') });
    const running = await startServices(new Map([[viaje.id, viaje]]));
    services.api = running.api;
    services.simulator = running.simulator;

    const response = await fetch(`${running.url}/api/viajes/V-201/cancelacion-cliente`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ motivo: 'Otro motivo' }),
    });

    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain('ya cancelado');
  });
});