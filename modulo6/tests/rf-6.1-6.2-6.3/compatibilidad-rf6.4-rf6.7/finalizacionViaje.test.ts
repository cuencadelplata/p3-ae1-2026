import express from 'express';
import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import pool from '../../../src/rf-6.1-6.2-6.3/db/pool.js';
import { EstadoViaje } from '../../../src/rf-6.1-6.2-6.3/models/viaje.model.js';
import * as viajeRepo from '../../../src/rf-6.1-6.2-6.3/repositories/viaje.repository.js';
import viajesRoutes from '../../../src/rf-6.1-6.2-6.3/routes/viajes.routes.js';

const app = express();
app.use(express.json());
app.use('/api/viajes', viajesRoutes);

const externalApis = express();
externalApis.use(express.json());

let apiServer: Server;
let externalServer: Server;
let apiUrl: string;
let externalUrl: string;
let externalFailureStatus = 0;
let authorizationCount = 0;
let authorizationDelayMs = 0;
const previousM4Url = process.env.M4_URL;
const previousM7Url = process.env.M7_URL;

externalApis.post('/api/v1/estimate', (_request, response) => {
  if (externalFailureStatus) return response.status(externalFailureStatus).json({ error: 'M4 no disponible' });
  return response.json({ distanceKm: 1.11, estimatedEtaMinutes: 3 });
});

externalApis.post('/tarifa/estimacion', (_request, response) => {
  if (externalFailureStatus) return response.status(externalFailureStatus).json({ error: 'M7 no disponible' });
  return response.json({ estimatedFare: 927.5 });
});

externalApis.post('/metodo-pago', (_request, response) => {
  if (externalFailureStatus) return response.status(externalFailureStatus).json({ error: 'M7 no disponible' });
  return response.json({ pagoId: 'PAY-test', estado: 'pendiente' });
});

externalApis.post('/metodo-pago/:viajeId/autorizar', async (_request, response) => {
  authorizationCount += 1;
  if (authorizationDelayMs) {
    await new Promise((resolve) => setTimeout(resolve, authorizationDelayMs));
  }
  if (externalFailureStatus) return response.status(externalFailureStatus).json({ error: 'M7 no disponible' });
  return response.json({ pagoId: 'PAY-test', estado: 'autorizado' });
});

async function listen(server: ReturnType<typeof express>): Promise<{ server: Server; url: string }> {
  const listener = server.listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => {
    listener.once('listening', resolve);
    listener.once('error', reject);
  });
  const address = listener.address();
  if (!address || typeof address === 'string') throw new Error('No se pudo iniciar el servidor de pruebas');
  return { server: listener, url: `http://127.0.0.1:${address.port}` };
}

beforeAll(async () => {
  const external = await listen(externalApis);
  externalServer = external.server;
  externalUrl = external.url;
  process.env.M4_URL = `${externalUrl}/api/v1`;
  process.env.M7_URL = externalUrl;

  const api = await listen(app);
  apiServer = api.server;
  apiUrl = api.url;
});

afterAll(async () => {
  await Promise.all([
    new Promise<void>((resolve, reject) => apiServer.close((error) => error ? reject(error) : resolve())),
    new Promise<void>((resolve, reject) => externalServer.close((error) => error ? reject(error) : resolve())),
  ]);
  if (previousM4Url === undefined) delete process.env.M4_URL;
  else process.env.M4_URL = previousM4Url;
  if (previousM7Url === undefined) delete process.env.M7_URL;
  else process.env.M7_URL = previousM7Url;
});

beforeEach(async () => {
  await pool.query('TRUNCATE viajes RESTART IDENTITY CASCADE');
  externalFailureStatus = 0;
  authorizationCount = 0;
  authorizationDelayMs = 0;
});

async function crearViajeEnCurso(): Promise<{ id: string; clienteId: string }> {
  const response = await fetch(`${apiUrl}/api/viajes`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      clienteId: `rf647-${Date.now()}-${Math.random()}`,
      origen: 'Calle A',
      destino: 'Calle B',
    }),
  });
  if (!response.ok) throw new Error(`No se pudo crear el viaje: ${response.status}`);
  const viaje = await response.json() as { id: string; clienteId: string };
  await viajeRepo.actualizarEstado(viaje.id, EstadoViaje.CONDUCTOR_EN_CAMINO, 'conductor-test');
  await viajeRepo.actualizarEstado(viaje.id, EstadoViaje.ARRIBADO);
  await viajeRepo.actualizarEstado(viaje.id, EstadoViaje.EN_CURSO);
  return viaje;
}

function solicitudFinalizacion(id: string, overrides: Record<string, unknown> = {}) {
  return fetch(`${apiUrl}/api/viajes/${encodeURIComponent(id)}/finalizacion`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      origen: { latitude: 0, longitude: 0 },
      destino: { latitude: 0, longitude: 0.01 },
      tipoVehiculo: 'auto',
      horaFin: new Date(Date.now() + 60_000).toISOString(),
      metodoPago: 'tarjeta',
      ...overrides,
    }),
  });
}

describe('Compatibilidad RF-6.4/RF-6.7 - finalización e historial', () => {
  it('finaliza el viaje, autoriza el pago y persiste una transición consultable', async () => {
    const viaje = await crearViajeEnCurso();
    const response = await solicitudFinalizacion(viaje.id);
    const body = await response.json();
    const persisted = await viajeRepo.buscarPorId(viaje.id);
    const storedFinalization = await pool.query(
      'SELECT data, payment_id FROM viaje_finalizaciones WHERE viaje_id = $1',
      [viaje.id],
    );

    expect(response.status).toBe(200);
    expect(body.viaje).toMatchObject({
      id: viaje.id,
      clienteId: viaje.clienteId,
      estado: 'completado',
      distanciaKm: 1.11,
      tiempoMinutos: 3,
      total: 927.5,
      metodoPago: 'tarjeta',
      metricasEstimadas: true,
    });
    expect(body).toMatchObject({ paymentId: 'PAY-test', fuenteMetrica: 'M4', metricasEstimadas: true });
    expect(persisted?.estado).toBe(EstadoViaje.COMPLETADO);
    expect(storedFinalization.rows[0]).toMatchObject({
      payment_id: 'PAY-test',
      data: { distanciaKm: 1.11, tiempoMinutos: 3, total: 927.5 },
    });

    const historyResponse = await fetch(`${apiUrl}/api/viajes/${viaje.id}/historial-transiciones`);
    const history = await historyResponse.json() as {
      historial: Array<{ from: string; to: string; detalle: string; timestamp: string }>;
    };
    expect(historyResponse.status).toBe(200);
    expect(history.historial).toHaveLength(4);
    const firstTransition = history.historial[0];
    const finalTransition = history.historial.at(-1);
    if (!firstTransition || !finalTransition) throw new Error('El historial no contiene las transiciones esperadas');
    expect(firstTransition).toMatchObject({
      from: 'solicitado',
      to: 'asignado',
      detalle: 'Asignación del conductor',
    });
    expect(finalTransition).toMatchObject({
      from: 'en curso',
      to: 'completado',
      detalle: 'Finalización del viaje',
    });
    expect(Number.isNaN(Date.parse(finalTransition.timestamp))).toBe(false);
  });

  it('rechaza estado inválido y datos incorrectos antes de llamar a M4/M7', async () => {
    const response = await fetch(`${apiUrl}/api/viajes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ clienteId: 'no-iniciado', origen: 'A', destino: 'B' }),
    });
    const viaje = await response.json() as { id: string };
    const invalidStateResponse = await solicitudFinalizacion(viaje.id);
    expect(invalidStateResponse.status).toBe(400);

    const inProgress = await crearViajeEnCurso();
    const invalidInputResponse = await solicitudFinalizacion(inProgress.id, {
      metodoPago: 'bitcoin',
    });
    expect(invalidInputResponse.status).toBe(400);
    expect(authorizationCount).toBe(0);
  });

  it('responde 404 para viajes inexistentes', async () => {
    const response = await solicitudFinalizacion('no-existe');
    expect(response.status).toBe(404);
  });

  it('mantiene el viaje en curso y sin historial de finalización si M4/M7 falla', async () => {
    const viaje = await crearViajeEnCurso();
    externalFailureStatus = 503;

    const response = await solicitudFinalizacion(viaje.id);
    const current = await viajeRepo.buscarPorId(viaje.id);
    const history = await viajeRepo.buscarHistorialTransiciones(viaje.id);

    expect(response.status).toBe(503);
    expect(current?.estado).toBe(EstadoViaje.EN_CURSO);
    expect(history.historial).toHaveLength(3);
  });

  it('serializa finalizaciones concurrentes para no autorizar dos pagos', async () => {
    const viaje = await crearViajeEnCurso();
    authorizationDelayMs = 50;

    const responses = await Promise.all([
      solicitudFinalizacion(viaje.id),
      solicitudFinalizacion(viaje.id),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([200, 400]);
    expect(authorizationCount).toBe(1);
  });

  it('devuelve 404 al consultar el historial de un viaje inexistente', async () => {
    const response = await fetch(`${apiUrl}/api/viajes/no-existe/historial-transiciones`);
    expect(response.status).toBe(404);
  });
});
