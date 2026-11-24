import express from 'express';
import type { Server } from 'node:http';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import pool from '../../../src/rf-6.1-6.2-6.3/db/pool.js';
import { EstadoViaje } from '../../../src/rf-6.1-6.2-6.3/models/viaje.model.js';
import * as viajeRepo from '../../../src/rf-6.1-6.2-6.3/repositories/viaje.repository.js';
import viajesRoutes from '../../../src/rf-6.1-6.2-6.3/routes/viajes.routes.js';
import { cerrarPublicador } from '../../../src/rf-6.1-6.2-6.3/services/eventos-viaje.service.js';
import { minutosTranscurridos } from '../../../src/rf-6.1-6.2-6.3/services/finalizacion.service.js';

const API_KEY = 'clave-test-m7';

const app = express();
app.use(express.json());
app.use('/api/viajes', viajesRoutes);

// Doble de M4/M7 que respeta los contratos reales de sus ramas más recientes.
const externalApis = express();
externalApis.use(express.json());

let apiServer: Server;
let externalServer: Server;
let apiUrl: string;
let externalFailureStatus = 0;
let escriturasPagoM7 = 0;
let consultaPagoDelayMs = 0;
let ultimaTarifa: Record<string, unknown> | undefined;
let llamadasM7 = 0;
const pagos = new Map<string, Record<string, unknown>>();
const previousEnv = { M4_URL: process.env.M4_URL, M7_URL: process.env.M7_URL, M7_API_KEY: process.env.M7_API_KEY };

externalApis.post('/api/v1/estimate', (_request, response) => {
  if (externalFailureStatus) return response.status(externalFailureStatus).json({ error: 'M4 no disponible' });
  return response.json({ distanceKm: 1.11, estimatedEtaMinutes: 3 });
});

externalApis.post('/tarifa/estimacion', (request, response) => {
  llamadasM7 += 1;
  if (externalFailureStatus) return response.status(externalFailureStatus).json({ error: 'M7 no disponible' });
  ultimaTarifa = request.body;
  return response.json({ estimatedFare: 927.5, currency: 'ARS' });
});

externalApis.use('/metodo-pago', (request, response, next) => {
  llamadasM7 += 1;
  if (request.header('x-api-key') !== API_KEY) return response.status(401).json({ mensaje: 'API key inválida o ausente' });
  return next();
});

externalApis.get('/metodo-pago/:viajeId', async (request, response) => {
  if (consultaPagoDelayMs) await new Promise((resolve) => setTimeout(resolve, consultaPagoDelayMs));
  if (externalFailureStatus) return response.status(externalFailureStatus).json({ mensaje: 'M7 no disponible' });
  const pago = pagos.get(request.params.viajeId);
  return pago ? response.json(pago) : response.status(404).json({ mensaje: 'No se encontró un pago para ese viaje' });
});

externalApis.post(['/metodo-pago', '/metodo-pago/:viajeId/autorizar'], (_request, response) => {
  escriturasPagoM7 += 1;
  return response.status(500).json({ error: 'M6 sólo debe consultar pagos' });
});

afterEach(() => {
  expect(escriturasPagoM7).toBe(0);
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
  process.env.M4_URL = `${external.url}/api/v1`;
  process.env.M7_URL = external.url;
  process.env.M7_API_KEY = API_KEY;

  const api = await listen(app);
  apiServer = api.server;
  apiUrl = api.url;
});

afterAll(async () => {
  await Promise.all([
    new Promise<void>((resolve, reject) => apiServer.close((error) => error ? reject(error) : resolve())),
    new Promise<void>((resolve, reject) => externalServer.close((error) => error ? reject(error) : resolve())),
  ]);
  await cerrarPublicador();
  for (const [key, value] of Object.entries(previousEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

beforeEach(async () => {
  await pool.query('TRUNCATE viajes RESTART IDENTITY CASCADE');
  externalFailureStatus = 0;
  escriturasPagoM7 = 0;
  consultaPagoDelayMs = 0;
  llamadasM7 = 0;
  ultimaTarifa = undefined;
  pagos.clear();
});

async function crearViajeEnCurso(
  clienteId = `rf647-${Date.now()}-${Math.random()}`,
  conductorId = 'conductor-test',
): Promise<{ id: string; clienteId: string }> {
  const response = await fetch(`${apiUrl}/api/viajes`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ clienteId, origen: 'Calle A', destino: 'Calle B' }),
  });
  if (!response.ok) throw new Error(`No se pudo crear el viaje: ${response.status}`);
  const viaje = await response.json() as { id: string; clienteId: string };
  await viajeRepo.actualizarEstado(viaje.id, EstadoViaje.CONDUCTOR_EN_CAMINO, conductorId);
  await viajeRepo.actualizarEstado(viaje.id, EstadoViaje.ARRIBADO);
  await viajeRepo.actualizarEstado(viaje.id, EstadoViaje.EN_CURSO);
  pagos.set(viaje.id, { pagoId: `PAY-${viaje.id}`, viajeId: viaje.id, tipo: 'tarjeta', estado: 'autorizado' });
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
      horaFin: new Date().toISOString(),
      metodoPago: 'tarjeta',
      ...overrides,
    }),
  });
}

describe('RF-6.4 - Finalización del viaje', () => {
  it('finaliza con tarjeta: registra tiempo real, distancia, tarifa y consulta el pago autorizado en M7', async () => {
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
      tiempoMinutos: 1,
      tiempoEstimadoMinutos: 3,
      total: 927.5,
      moneda: 'ARS',
      metodoPago: 'tarjeta',
      estadoPago: 'autorizado',
    });
    expect(body.viaje).not.toHaveProperty('codigoVerificacion');
    expect(body).toMatchObject({ paymentId: `PAY-${viaje.id}`, estadoPago: 'autorizado', idempotente: false });
    expect(persisted?.estado).toBe(EstadoViaje.COMPLETADO);
    expect(storedFinalization.rows[0]).toMatchObject({
      payment_id: `PAY-${viaje.id}`,
      data: { distanciaKm: 1.11, tiempoMinutos: 1, total: 927.5, estadoPago: 'autorizado' },
    });
    // La finalización conserva el estado consultado y no contiene datos de tarjeta.
    expect(JSON.stringify(storedFinalization.rows[0].data)).not.toContain('tok-test');
    expect(JSON.stringify(storedFinalization.rows[0].data)).not.toContain('cliente@example.com');

    // La tarifa usa el tiempo real; la autorización ya existe en M7.
    expect(ultimaTarifa).toMatchObject({ distanciaKm: 1.11, tiempoEstimadoMin: 1, vehicleType: 'auto' });
    expect(escriturasPagoM7).toBe(0);
  });

  it('tolera un reloj levemente atrasado: horaFin se ajusta al inicio', async () => {
    const viaje = await crearViajeEnCurso();
    const response = await solicitudFinalizacion(viaje.id, { horaFin: new Date(Date.now() - 30_000).toISOString() });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.viaje.horaFin).toBe(body.viaje.inicio);
    expect(body.viaje.tiempoMinutos).toBe(1);
  });

  it('calcula la duración real entre el inicio y horaFin', () => {
    const inicio = new Date('2026-11-16T10:00:00Z');
    expect(minutosTranscurridos(inicio, new Date('2026-11-16T10:25:10Z'))).toBe(26);
    expect(minutosTranscurridos(inicio, new Date('2026-11-16T10:00:20Z'))).toBe(1);
  });

  it.each(['efectivo', 'transferencia', 'tarjeta'])('finaliza con %s consultando su autorización en M7', async (tipo) => {
    const viaje = await crearViajeEnCurso();
    pagos.set(viaje.id, { pagoId: `PAY-${viaje.id}`, viajeId: viaje.id, tipo, estado: 'autorizado' });
    const response = await solicitudFinalizacion(viaje.id, { metodoPago: tipo });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      estadoPago: 'autorizado', paymentId: `PAY-${viaje.id}`,
      viaje: { metodoPago: tipo, estadoPago: 'autorizado' },
    });
    const stored = await viajeRepo.buscarPorId(viaje.id);
    expect(stored?.estado).toBe(EstadoViaje.COMPLETADO);
  });

  it.each(['pendiente', 'rechazado', 'cancelado'])('bloquea trip.completed cuando M7 informa %s', async (estado) => {
    const viaje = await crearViajeEnCurso();
    pagos.get(viaje.id)!.estado = estado;
    expect((await solicitudFinalizacion(viaje.id)).status).toBe(402);
    expect((await viajeRepo.buscarPorId(viaje.id))?.estado).toBe(EstadoViaje.EN_CURSO);
    const { rows } = await pool.query("SELECT count(*)::int AS total FROM viaje_eventos_outbox WHERE viaje_id = $1 AND routing_key = 'trip.completed'", [viaje.id]);
    expect(rows[0].total).toBe(0);
  });

  it('rechaza finalizar si M7 no tiene un pago registrado', async () => {
    const viaje = await crearViajeEnCurso();
    pagos.delete(viaje.id);
    expect((await solicitudFinalizacion(viaje.id)).status).toBe(402);
    expect(pagos.has(viaje.id)).toBe(false);
    expect((await viajeRepo.buscarPorId(viaje.id))?.estado).toBe(EstadoViaje.EN_CURSO);
  });

  it('rechaza un medio autorizado diferente al seleccionado', async () => {
    const viaje = await crearViajeEnCurso();
    expect((await solicitudFinalizacion(viaje.id, { metodoPago: 'efectivo' })).status).toBe(402);
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
    const casosInvalidos: Array<Record<string, unknown>> = [
      { metodoPago: 'bitcoin' },
      { destino: { latitude: 0, longitude: 0 } },
      { tipoVehiculo: 'camion' },
      { horaFin: new Date(Date.now() + 60 * 60_000).toISOString() },
      { horaFin: '2020-01-01T00:00:00Z' },
      { horaFin: 'ayer' },
    ];
    for (const overrides of casosInvalidos) {
      const invalidInputResponse = await solicitudFinalizacion(inProgress.id, overrides);
      expect(invalidInputResponse.status, JSON.stringify(overrides)).toBe(400);
    }
    expect(llamadasM7).toBe(0);
    expect((await viajeRepo.buscarPorId(inProgress.id))?.estado).toBe(EstadoViaje.EN_CURSO);
  });

  it('responde 404 para viajes inexistentes', async () => {
    const response = await solicitudFinalizacion('no-existe');
    expect(response.status).toBe(404);
  });

  it('mantiene el viaje en curso y sin transición de finalización si M4/M7 falla', async () => {
    const viaje = await crearViajeEnCurso();
    externalFailureStatus = 503;

    const response = await solicitudFinalizacion(viaje.id);
    const current = await viajeRepo.buscarPorId(viaje.id);
    const history = await viajeRepo.buscarHistorialTransiciones(viaje.id);

    expect(response.status).toBe(503);
    expect(current?.estado).toBe(EstadoViaje.EN_CURSO);
    expect(history.historial.map((transicion) => transicion.to)).not.toContain(EstadoViaje.COMPLETADO);
  });

  it('finalizaciones concurrentes: una sola finalización y la misma respuesta para ambas', async () => {
    const viaje = await crearViajeEnCurso();
    consultaPagoDelayMs = 50;

    const responses = await Promise.all([
      solicitudFinalizacion(viaje.id),
      solicitudFinalizacion(viaje.id),
    ]);
    const bodies = await Promise.all(responses.map((response) => response.json()));

    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    expect(bodies.map((body) => body.idempotente).sort()).toEqual([false, true]);
    expect(bodies[0].paymentId).toBe(bodies[1].paymentId);
    expect(escriturasPagoM7).toBe(0);
    const transiciones = await pool.query(
      'SELECT count(*)::int AS total FROM viaje_transiciones WHERE viaje_id = $1 AND estado_nuevo = $2',
      [viaje.id, EstadoViaje.COMPLETADO],
    );
    expect(transiciones.rows[0].total).toBe(1);
  });

  it('un reintento sobre un viaje ya completado devuelve la finalización registrada sin llamar a M7', async () => {
    const viaje = await crearViajeEnCurso();
    const primera = await (await solicitudFinalizacion(viaje.id)).json();
    llamadasM7 = 0;

    const reintento = await solicitudFinalizacion(viaje.id);
    const body = await reintento.json();

    expect(reintento.status).toBe(200);
    expect(body).toMatchObject({ idempotente: true, paymentId: primera.paymentId });
    expect(body.viaje.total).toBe(primera.viaje.total);
    expect(llamadasM7).toBe(0);
  });

  it('se recupera si M7 ya autorizó el pago en un intento previo que no llegó a persistirse', async () => {
    const viaje = await crearViajeEnCurso();
    pagos.set(viaje.id, { pagoId: `PAY-${viaje.id}`, viajeId: viaje.id, estado: 'autorizado' });

    const response = await solicitudFinalizacion(viaje.id);

    expect(response.status).toBe(200);
    expect(escriturasPagoM7).toBe(0);
    expect((await viajeRepo.buscarPorId(viaje.id))?.estado).toBe(EstadoViaje.COMPLETADO);
  });

  it('deja en el outbox los eventos de finalización para M3, M4 y M8', async () => {
    const viaje = await crearViajeEnCurso('42', '7');
    expect((await solicitudFinalizacion(viaje.id)).status).toBe(200);

    const { rows } = await pool.query(
      'SELECT exchange, routing_key, payload FROM viaje_eventos_outbox WHERE viaje_id = $1 ORDER BY exchange',
      [viaje.id],
    );
    const porExchange = Object.fromEntries(rows.map((row) => [row.exchange, row]));

    expect(Object.keys(porExchange).sort()).toEqual(['mobility.events', 'trip.events', 'viajes.events']);
    expect(porExchange['mobility.events']).toMatchObject({
      routing_key: 'trip.completed',
      payload: {
        eventType: 'TripCompleted',
        version: 1,
        correlationId: viaje.id,
        producer: 'm6-viajes',
        data: { tripId: viaje.id, recipientId: 42 },
      },
    });
    expect(porExchange['viajes.events']).toMatchObject({
      routing_key: 'viaje.finalizado',
      payload: { eventType: 'viaje.finalizado', data: { viajeId: viaje.id, conductorId: '7', clienteId: '42' } },
    });
    expect(porExchange['trip.events']).toMatchObject({
      routing_key: 'viaje.finalizado',
      payload: { eventType: 'viaje.finalizado', tripId: viaje.id, driverId: 7 },
    });
  });

  it('guarda el evento M4 y un TripCancelled M8 por destinatario al cancelar', async () => {
    const crearResponse = await fetch(`${apiUrl}/api/viajes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        clienteId: 'cliente-texto',
        clientUserId: 42,
        origen: 'Calle A',
        destino: 'Calle B',
      }),
    });
    const viaje = await crearResponse.json() as { id: string };
    await viajeRepo.actualizarEstado(viaje.id, EstadoViaje.CONDUCTOR_EN_CAMINO, 'conductor-texto', 55);

    const cancelacion = await fetch(`${apiUrl}/api/viajes/${viaje.id}/cancelacion`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ actor: 'conductor', motivo: 'Imprevisto' }),
    });
    expect(cancelacion.status).toBe(200);

    const { rows } = await pool.query(
      'SELECT exchange, routing_key, payload FROM viaje_eventos_outbox WHERE viaje_id = $1 ORDER BY exchange, routing_key',
      [viaje.id],
    );
    const eventosM8 = rows.filter((row) => row.exchange === 'mobility.events');

    expect(rows.filter((row) => row.exchange === 'trip.events')).toHaveLength(1);
    expect(rows.find((row) => row.exchange === 'trip.events')).toMatchObject({
      routing_key: 'viaje.cancelado',
      payload: { eventType: 'viaje.cancelado', tripId: viaje.id, driverId: 55 },
    });
    expect(eventosM8).toHaveLength(2);
    expect(eventosM8.every((evento) => evento.routing_key === 'trip.cancelled')).toBe(true);
    expect(eventosM8.map((evento) => (evento.payload.data as { recipientId: number }).recipientId)
      .sort()).toEqual([42, 55]);
    expect(eventosM8[0].payload).toMatchObject({
      eventType: 'TripCancelled',
      correlationId: viaje.id,
      producer: 'm6-viajes',
      data: { tripId: viaje.id, cancelledBy: 'conductor', motivo: 'Imprevisto' },
    });
  });

  it('omite los eventos que requieren ids numéricos de M1 cuando no los hay', async () => {
    const viaje = await crearViajeEnCurso('cliente-texto', 'conductor-texto');
    expect((await solicitudFinalizacion(viaje.id)).status).toBe(200);

    const { rows } = await pool.query('SELECT exchange FROM viaje_eventos_outbox WHERE viaje_id = $1', [viaje.id]);
    expect(rows.map((row) => row.exchange)).toEqual(['viajes.events']);
  });
});

describe('RF-6.7 - Historial de transiciones', () => {
  it('registra el ciclo completo desde la solicitud, con estados distinguibles', async () => {
    const viaje = await crearViajeEnCurso();
    expect((await solicitudFinalizacion(viaje.id)).status).toBe(200);

    const historyResponse = await fetch(`${apiUrl}/api/viajes/${viaje.id}/historial-transiciones`);
    const history = await historyResponse.json() as {
      historial: Array<{ from: string | null; to: string; detalle: string; timestamp: string }>;
    };

    expect(historyResponse.status).toBe(200);
    expect(history.historial.map(({ from, to, detalle }) => ({ from, to, detalle }))).toEqual([
      { from: null, to: 'solicitado', detalle: 'Solicitud del viaje' },
      { from: 'solicitado', to: 'conductor en camino', detalle: 'Asignación del conductor' },
      { from: 'conductor en camino', to: 'arribado', detalle: 'Arribo del conductor' },
      { from: 'arribado', to: 'en curso', detalle: 'Inicio de viaje' },
      { from: 'en curso', to: 'completado', detalle: 'Finalización del viaje' },
    ]);
    const timestamps = history.historial.map((transicion) => Date.parse(transicion.timestamp));
    expect(timestamps.every((timestamp) => !Number.isNaN(timestamp))).toBe(true);
    expect([...timestamps].sort((a, b) => a - b)).toEqual(timestamps);
  });

  it('impide modificar o borrar transiciones y finalizaciones ya registradas', async () => {
    const viaje = await crearViajeEnCurso();
    expect((await solicitudFinalizacion(viaje.id)).status).toBe(200);

    await expect(pool.query(
      `UPDATE viaje_transiciones SET detalle = 'reescrito' WHERE viaje_id = $1`, [viaje.id],
    )).rejects.toThrow(/solo inserción/);
    await expect(pool.query('DELETE FROM viaje_transiciones WHERE viaje_id = $1', [viaje.id])).rejects.toThrow(/solo inserción/);
    await expect(pool.query(
      `UPDATE viaje_finalizaciones SET payment_id = 'otro' WHERE viaje_id = $1`, [viaje.id],
    )).rejects.toThrow(/solo inserción/);
    // Borrar el viaje tampoco puede arrastrar su historial por la cascada.
    await expect(pool.query('DELETE FROM viajes WHERE id = $1', [viaje.id])).rejects.toThrow(/solo inserción/);

    const history = await viajeRepo.buscarHistorialTransiciones(viaje.id);
    expect(history.historial).toHaveLength(5);
    expect(history.historial.every((transicion) => transicion.detalle !== 'reescrito')).toBe(true);
  });

  it('un viaje recién solicitado ya tiene su transición inicial', async () => {
    const response = await fetch(`${apiUrl}/api/viajes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ clienteId: 'c-nuevo', origen: 'A', destino: 'B' }),
    });
    const viaje = await response.json() as { id: string };
    const history = await (await fetch(`${apiUrl}/api/viajes/${viaje.id}/historial-transiciones`)).json();

    expect(history.historial).toHaveLength(1);
    expect(history.historial[0]).toMatchObject({ from: null, to: 'solicitado' });
  });

  it('devuelve 404 al consultar el historial de un viaje inexistente', async () => {
    const response = await fetch(`${apiUrl}/api/viajes/no-existe/historial-transiciones`);
    expect(response.status).toBe(404);
  });
});
