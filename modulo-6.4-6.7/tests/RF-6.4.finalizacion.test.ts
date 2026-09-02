import { afterEach, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { Viaje } from '../src/Viaje.js';
import { startServices, stopServices } from './helpers.js';

describe('RF-6.4 - Finalización del viaje', () => {
  const services: { api?: Server; simulator?: Server } = {};

  afterEach(() => {
    if (services.api && services.simulator) stopServices(services.api, services.simulator);
  });

  it('registra tiempo, distancia, tarifa y pago mediante APIs externas', async () => {
    const viaje = new Viaje({ id: 'V-100', clienteId: 'C-1', conductorId: 'D-1', estado: 'en curso', tarifaBase: 0, tarifaPorKm: 0, tarifaPorMinuto: 0, inicio: new Date('2026-09-01T10:00:00Z') });
    const running = await startServices(new Map([[viaje.id, viaje]]));
    services.api = running.api;
    services.simulator = running.simulator;

    const response = await fetch(`${running.url}/api/viajes/V-100/finalizacion`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tiempoMinutos: 42, distanciaKm: 18.5, horaFin: '2026-09-01T10:42:00Z', metodoPago: 'tarjeta' }),
    });
    const body = await response.json() as { viaje: Viaje; paymentId: string };

    expect(response.status).toBe(200);
    expect(body.viaje.estado).toBe('completado');
    expect(body.viaje.total).toBe(150 + 18.5 * 80 + 42 * 25);
    expect(body.viaje.tiempoMinutos).toBe(42);
    expect(body.viaje.distanciaKm).toBe(18.5);
    expect(body.paymentId).toBe('PAY-V-100');
  });

  it('rechaza finalizar un viaje ya completado', async () => {
    const viaje = new Viaje({ id: 'V-101', clienteId: 'C-2', conductorId: 'D-2', estado: 'completado', tarifaBase: 0, tarifaPorKm: 0, tarifaPorMinuto: 0, inicio: new Date('2026-09-01T08:00:00Z') });
    const running = await startServices(new Map([[viaje.id, viaje]]));
    services.api = running.api;
    services.simulator = running.simulator;

    const response = await fetch(`${running.url}/api/viajes/V-101/finalizacion`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tiempoMinutos: 30, distanciaKm: 12, horaFin: '2026-09-01T08:30:00Z', metodoPago: 'efectivo' }),
    });

    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain('ya finalizado');
  });
});