import { afterEach, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { Viaje } from '../src/Viaje.js';
import { startServices, stopServices } from './helpers.js';

describe('RF-6.7 - Historial de transiciones', () => {
  const services: { api?: Server; simulator?: Server } = {};

  afterEach(() => {
    if (services.api && services.simulator) stopServices(services.api, services.simulator);
  });

  it('devuelve el historial append-only de transiciones sin editar entradas previas', async () => {
    const viaje = new Viaje({ id: 'V-400', clienteId: 'C-40', conductorId: 'D-40', estado: 'asignado', tarifaBase: 0, tarifaPorKm: 0, tarifaPorMinuto: 0, inicio: new Date('2026-09-01T13:00:00Z') });
    const registrarTransicion = (viaje as any).registrarTransicion.bind(viaje) as (from: string, to: string, detalle?: string) => void;
    registrarTransicion('asignado', 'en curso', 'Inicio de viaje');
    registrarTransicion('en curso', 'completado', 'Finalización del viaje');

    const running = await startServices(new Map([[viaje.id, viaje]]));
    services.api = running.api;
    services.simulator = running.simulator;

    const response = await fetch(`${running.url}/api/viajes/V-400/historial-transiciones`);
    const body = await response.json() as { historial: Array<{ from: string; to: string; detalle?: string }> };

    expect(response.status).toBe(200);
    expect(body.historial).toHaveLength(2);
    expect(body.historial[0]).toMatchObject({ from: 'asignado', to: 'en curso', detalle: 'Inicio de viaje' });
    expect(body.historial[1]).toMatchObject({ from: 'en curso', to: 'completado', detalle: 'Finalización del viaje' });
  });
});
