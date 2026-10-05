import { afterEach, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { Viaje } from '../../src/m6-rf-6.4-rf6.7/Viaje.js';
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
      body: JSON.stringify({
        origen: { latitude: 0, longitude: 0 },
        destino: { latitude: 0, longitude: 0.01 },
        tipoVehiculo: 'auto',
        horaFin: '2026-09-01T10:42:00Z',
        metodoPago: 'tarjeta',
        distanciaKm: 999,
        tiempoMinutos: 999,
      }),
    });
    const body = await response.json() as {
      viaje: Viaje;
      paymentId: string;
      metricasEstimadas: boolean;
      fuenteMetrica: string;
    };

    expect(response.status).toBe(200);
    expect(body.viaje.estado).toBe('completado');
    expect(body.viaje.total).toBe(927.5);
    expect(body.viaje.tiempoMinutos).toBe(3);
    expect(body.viaje.distanciaKm).toBe(1.11);
    expect(body.viaje.metricasEstimadas).toBe(true);
    expect(body.metricasEstimadas).toBe(true);
    expect(body.fuenteMetrica).toBe('M4');
    expect(body.paymentId).toBe('PAY-V-100');
  });

  it('rechaza finalizar un viaje ya completado', async () => {
    const viaje = new Viaje({ id: 'V-101', clienteId: 'C-2', conductorId: 'D-2', estado: 'completado', tarifaBase: 0, tarifaPorKm: 0, tarifaPorMinuto: 0, inicio: new Date('2026-09-01T08:00:00Z') });
    const running = await startServices(new Map([[viaje.id, viaje]]));
    services.api = running.api;
    services.simulator = running.simulator;

    const response = await fetch(`${running.url}/api/viajes/V-101/finalizacion`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        origen: { latitude: -34.6, longitude: -58.4 },
        destino: { latitude: -34.7, longitude: -58.5 },
        tipoVehiculo: 'auto',
        horaFin: '2026-09-01T08:30:00Z',
        metodoPago: 'efectivo',
      }),
    });

    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain('ya finalizado');
  });

  it('simula los contratos HTTP de tarifas y pagos de M7', async () => {
    const running = await startServices(new Map());
    services.api = running.api;
    services.simulator = running.simulator;
    const simulatorPort = (running.simulator.address() as { port: number }).port;
    const simulatorUrl = `http://127.0.0.1:${simulatorPort}`;

    const fareResponse = await fetch(`${simulatorUrl}/tarifa/estimacion`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        origen: { lat: -34.6, lng: -58.4 },
        destino: { lat: -34.7, lng: -58.5 },
        distanciaKm: 18.5,
        tiempoEstimadoMin: 42,
        vehicleType: 'auto',
      }),
    });
    const fare = await fareResponse.json() as { estimatedFare: number; currency: string };
    expect(fareResponse.status).toBe(200);
    expect(fare).toMatchObject({ estimatedFare: 7225, currency: 'ARS' });

    const paymentResponse = await fetch(`${simulatorUrl}/metodo-pago`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ clienteId: 'C-7', viajeId: 'V-700', tipo: 'tarjeta' }),
    });
    const payment = await paymentResponse.json() as { pagoId: string; estado: string };
    expect(paymentResponse.status).toBe(201);
    expect(payment).toMatchObject({ pagoId: 'PAY-V-700', estado: 'pendiente' });

    const authorizationResponse = await fetch(`${simulatorUrl}/metodo-pago/V-700/autorizar`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ idOrden: 'ORD-V-700' }),
    });
    expect(authorizationResponse.status).toBe(200);
    expect(await authorizationResponse.json()).toMatchObject({ pagoId: 'PAY-V-700', estado: 'autorizado' });
  });
});