import { afterEach, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { Viaje } from '../src/Viaje.js';
import { startServices, stopServices } from './helpers.js';

describe('RF-6.6 - Cancelación por conductor', () => {
  const services: { api?: Server; simulator?: Server } = {};

  afterEach(() => {
    if (services.api && services.simulator) stopServices(services.api, services.simulator);
  });

  it('retorna al cliente al proceso de despacho y registra el motivo del conductor', async () => {
    const viaje = new Viaje({ id: 'V-300', clienteId: 'C-30', conductorId: 'D-30', estado: 'asignado', tarifaBase: 0, tarifaPorKm: 0, tarifaPorMinuto: 0, inicio: new Date('2026-09-01T12:00:00Z') });
    const running = await startServices(new Map([[viaje.id, viaje]]));
    services.api = running.api;
    services.simulator = running.simulator;

    const response = await fetch(`${running.url}/api/viajes/V-300/cancelacion-conductor`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ motivo: 'Se me averió el vehículo' }),
    });
    const body = await response.json() as { viaje: Viaje; retornoDespacho: { reabrirDespacho: boolean; clienteRetornado: boolean } };

    expect(response.status).toBe(200);
    expect(body.viaje.estado).toBe('cancelado');
    expect(body.viaje.motivoCancelacionConductor).toBe('Se me averió el vehículo');
    expect(body.viaje.retornoDespacho).toMatchObject({ reabrirDespacho: true, clienteRetornado: true });
    expect(body.retornoDespacho).toMatchObject({ reabrirDespacho: true, clienteRetornado: true });
    expect(body.viaje.historialTransiciones.at(-1)?.detalle).toContain('Cancelación por conductor');
  });

  it('rechaza cancelar un viaje ya finalizado', async () => {
    const viaje = new Viaje({ id: 'V-301', clienteId: 'C-31', conductorId: 'D-31', estado: 'completado', tarifaBase: 0, tarifaPorKm: 0, tarifaPorMinuto: 0, inicio: new Date('2026-09-01T12:05:00Z') });
    const running = await startServices(new Map([[viaje.id, viaje]]));
    services.api = running.api;
    services.simulator = running.simulator;

    const response = await fetch(`${running.url}/api/viajes/V-301/cancelacion-conductor`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ motivo: 'No puedo continuar' }),
    });

    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain('ya finalizado');
  });
});
