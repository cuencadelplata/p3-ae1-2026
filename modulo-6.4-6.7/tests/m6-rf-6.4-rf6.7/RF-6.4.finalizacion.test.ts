import { afterEach, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { crearViaje, startServices, stopServices, StubViajesApiClient } from './helpers.js';

describe('RF-6.4 - Fachada de finalización', () => {
  const services: { api?: Server; simulator?: Server } = {};

  afterEach(() => {
    if (services.api && services.simulator) stopServices(services.api, services.simulator);
    services.api = undefined;
    services.simulator = undefined;
  });

  it('reenvía la finalización a Viajes y conserva su respuesta', async () => {
    const viajesApi = new StubViajesApiClient();
    const running = await startServices(viajesApi);
    services.api = running.api;
    services.simulator = running.simulator;
    const viaje = await crearViaje(running.url, 'C-1');
    viajesApi.cambiarEstado(viaje.id, 'EN_CURSO');

    const response = await fetch(`${running.url}/api/viajes/${viaje.id}/finalizacion`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
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
      viaje: Record<string, unknown>;
      paymentId: string;
      metricasEstimadas: boolean;
      fuenteMetrica: string;
    };

    expect(response.status).toBe(200);
    expect(body.viaje).toMatchObject({
      id: viaje.id,
      estado: 'completado',
      total: 927.5,
      tiempoMinutos: 3,
      distanciaKm: 1.11,
    });
    expect(body).toMatchObject({
      paymentId: `PAY-${viaje.id}`,
      metricasEstimadas: true,
      fuenteMetrica: 'M4',
    });
    expect(viajesApi.viajes.get(viaje.id)?.estado).toBe('COMPLETADO');
  });

  it('propaga la transición inválida informada por Viajes', async () => {
    const viajesApi = new StubViajesApiClient();
    const running = await startServices(viajesApi);
    services.api = running.api;
    services.simulator = running.simulator;
    const viaje = await crearViaje(running.url, 'C-2');

    const response = await fetch(`${running.url}/api/viajes/${viaje.id}/finalizacion`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        origen: { latitude: -34.6, longitude: -58.4 },
        destino: { latitude: -34.7, longitude: -58.5 },
        tipoVehiculo: 'auto',
        horaFin: '2026-09-01T08:30:00Z',
        metodoPago: 'efectivo',
      }),
    });

    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain('estado SOLICITADO');
  });

  it('devuelve 502 si Viajes devuelve una respuesta inválida', async () => {
    const running = await startServices({
      crearViaje: async (input) => ({
        status: 201,
        body: {
          id: 'CENTRAL-1',
          clienteId: input.clienteId,
          estado: 'SOLICITADO',
          fechaCreacion: new Date().toISOString(),
        },
      }),
      finalizarViaje: async () => ({ status: 502, body: { error: 'Respuesta inválida de M4' } }),
      obtenerHistorial: async () => ({ status: 200, body: { historial: [] } }),
    });
    services.api = running.api;
    services.simulator = running.simulator;
    const viaje = await crearViaje(running.url);

    const response = await fetch(`${running.url}/api/viajes/${viaje.id}/finalizacion`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(response.status).toBe(502);
  });

  it('simula los contratos HTTP de tarifas y pagos de M7', async () => {
    const running = await startServices();
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
  });
});
