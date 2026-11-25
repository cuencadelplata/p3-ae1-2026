import express from 'express';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import pool from '../../../src/rf-6.1-6.2-6.3/db/pool.js';
import { EstadoViaje } from '../../../src/rf-6.1-6.2-6.3/models/viaje.model.js';
import * as viajeRepo from '../../../src/rf-6.1-6.2-6.3/repositories/viaje.repository.js';
import viajesRoutes from '../../../src/rf-6.1-6.2-6.3/routes/viajes.routes.js';

const app = express();
app.use(express.json());
app.use('/api/viajes', viajesRoutes);

let server: ReturnType<typeof app.listen>;
let baseUrl: string;

beforeAll(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No se pudo iniciar el servidor de pruebas');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

beforeEach(async () => {
  await pool.query('TRUNCATE viajes RESTART IDENTITY CASCADE');
});

async function crearViaje(): Promise<{ id: string; clienteId: string }> {
  const clienteId = `rf65-66-${Date.now()}-${Math.random()}`;
  const response = await fetch(`${baseUrl}/api/viajes`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ clienteId, origen: 'Calle A', destino: 'Calle B' }),
  });
  if (!response.ok) throw new Error(`No se pudo crear el viaje de prueba: ${response.status}`);
  return response.json() as Promise<{ id: string; clienteId: string }>;
}

async function solicitarCancelacion(id: string, body: unknown = { actor: 'cliente', motivo: 'Cambio de planes' }) {
  return fetch(`${baseUrl}/api/viajes/${encodeURIComponent(id)}/cancelacion`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('Compatibilidad RF-6.5/RF-6.6 - rutas de viaje', () => {
  it.each(['POST', 'PATCH'])('asigna un conductor mediante %s y permite cancelar el mismo viaje', async (method) => {
    const created = await crearViaje();
    const response = await fetch(`${baseUrl}/api/viajes/${created.id}/asignar`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ conductorId: 'conductor-integracion' }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      viaje: { id: created.id, conductorId: 'conductor-integracion', estado: 'CONDUCTOR_EN_CAMINO' },
    });
    const cancelled = await solicitarCancelacion(created.id);
    expect(cancelled.status).toBe(200);
    expect(await cancelled.json()).toMatchObject({ id: created.id, estado: 'CANCELADO' });
  });

  it('GET devuelve el viaje directamente con los campos de integración', async () => {
    const created = await crearViaje();
    const response = await fetch(`${baseUrl}/api/viajes/${created.id}`);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      id: created.id,
      clienteId: created.clienteId,
      conductorId: null,
      clientUserId: null,
      estado: 'SOLICITADO',
      // M2 importa direcciones con estos campos.
      origen: 'Calle A',
      destino: 'Calle B',
      rideRequestId: null,
    });
    expect(Number.isNaN(Date.parse(body.fechaCreacion))).toBe(false);
    expect(body).not.toHaveProperty('completadoAt');
    expect(body).not.toHaveProperty('codigoVerificacion');
    expect(body).not.toHaveProperty('viaje');
  });

  it('GET de un viaje completado incluye completadoAt (hora de fin de RF-6.4) para M2', async () => {
    const created = await crearViaje();
    await viajeRepo.actualizarEstado(created.id, EstadoViaje.CONDUCTOR_EN_CAMINO, 'conductor-test');
    await viajeRepo.actualizarEstado(created.id, EstadoViaje.ARRIBADO);
    await viajeRepo.actualizarEstado(created.id, EstadoViaje.EN_CURSO);
    const horaFin = new Date();
    await viajeRepo.finalizarSiEnCurso(created.id, async (_viaje, inicio) => ({
      inicio, horaFin, tiempoMinutos: 1, tiempoEstimadoMinutos: 1, distanciaKm: 1, metodoPago: 'efectivo',
      total: 500, moneda: 'ARS', origen: { latitude: 0, longitude: 0 }, destino: { latitude: 0, longitude: 0.01 },
      tipoVehiculo: 'auto', fuenteMetrica: 'M4', metricasEstimadas: true, estadoPago: 'pendiente', paymentId: 'PAY-x',
    }));

    const body = await (await fetch(`${baseUrl}/api/viajes/${created.id}`)).json();

    expect(body).toMatchObject({ estado: 'COMPLETADO', origen: 'Calle A', destino: 'Calle B' });
    expect(new Date(body.completadoAt).getTime()).toBe(horaFin.getTime());
  });

  it('GET devuelve el rideRequestId de M5 cuando el viaje se creó desde el despacho', async () => {
    const response = await fetch(`${baseUrl}/api/viajes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'Idempotency-Key': `idem-${Date.now()}` },
      body: JSON.stringify({ clienteId: 'cliente-m5', origen: 'A', destino: 'B', rideRequestId: 'ride-req-123' }),
    });
    const created = await response.json() as { id: string };

    const body = await (await fetch(`${baseUrl}/api/viajes/${created.id}`)).json();
    expect(body.rideRequestId).toBe('ride-req-123');
  });

  it('GET conserva el clientUserId de M1 informado al crear el viaje', async () => {
    const response = await fetch(`${baseUrl}/api/viajes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ clienteId: 'cliente-m1', clientUserId: 123, origen: 'A', destino: 'B' }),
    });
    expect(response.status).toBe(201);
    const created = await response.json() as { id: string };

    const consulta = await fetch(`${baseUrl}/api/viajes/${created.id}`);
    expect(consulta.status).toBe(200);
    expect(await consulta.json()).toMatchObject({
      id: created.id, clienteId: 'cliente-m1', clientUserId: 123,
    });
  });

  it('GET responde 404 si el viaje no existe', async () => {
    const response = await fetch(`${baseUrl}/api/viajes/no-existe`);
    expect(response.status).toBe(404);
  });

  it('GET responde 503 si falla la base de datos', async () => {
    vi.spyOn(viajeRepo, 'buscarPorId').mockRejectedValueOnce(new Error('TripDB no disponible'));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const response = await fetch(`${baseUrl}/api/viajes/cualquier-id`);
    expect(response.status).toBe(503);
  });

  it.each(['cliente', 'conductor'].flatMap((actor) =>
    ['SOLICITADO', 'ASIGNADO', 'CONDUCTOR_EN_CAMINO', 'ARRIBADO', 'EN_CURSO'].map((estado) => [estado, actor])
  ))('permite cancelar en %s como %s, registra actor y conserva historial', async (estado, actor) => {
    const created = await crearViaje();
    await pool.query('UPDATE viajes SET estado = $1, conductor_id = $2 WHERE id = $3', [estado, 'conductor-test', created.id]);
    const response = await solicitarCancelacion(created.id, { actor, motivo: 'No puedo continuar' });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ id: created.id, estado: 'CANCELADO', canceladoPor: actor });
    const stored = await viajeRepo.buscarPorId(created.id);
    expect(stored?.estado).toBe('CANCELADO');
    expect(stored?.canceladoPor).toBe(actor);
    const { rows } = await pool.query('SELECT estado_anterior, estado_nuevo FROM viaje_transiciones WHERE viaje_id = $1 ORDER BY id DESC LIMIT 1', [created.id]);
    expect(rows[0]).toEqual({ estado_anterior: estado, estado_nuevo: 'CANCELADO' });
    const repeat = await solicitarCancelacion(created.id, { actor, motivo: 'Reintento' });
    expect(repeat.status).toBe(400);
  });

  it('serializa cancelaciones simultáneas y registra un solo hecho y evento', async () => {
    const created = await crearViaje();
    await pool.query('UPDATE viajes SET estado = $1, conductor_id = $3, driver_user_id = $4 WHERE id = $2', ['EN_CURSO', created.id, '55', 55]);
    const responses = await Promise.all(['cliente', 'conductor'].map((actor) =>
      solicitarCancelacion(created.id, { actor, motivo: 'Cancelación concurrente' })
    ));
    expect(responses.map((response) => response.status).sort()).toEqual([200, 400]);
    const history = await pool.query("SELECT count(*)::int AS total FROM viaje_transiciones WHERE viaje_id = $1 AND estado_nuevo = 'CANCELADO'", [created.id]);
    expect(history.rows[0].total).toBe(1);
    const events = await pool.query("SELECT count(*)::int AS total FROM viaje_eventos_outbox WHERE viaje_id = $1 AND routing_key = 'viaje.cancelado'", [created.id]);
    expect(events.rows[0].total).toBe(1);
  });

  it.each(['COMPLETADO', 'CANCELADO'])(
    'rechaza la cancelación cuando el estado es %s',
    async (estado) => {
      const created = await crearViaje();
      await pool.query('UPDATE viajes SET estado = $1 WHERE id = $2', [estado, created.id]);

      const response = await solicitarCancelacion(created.id);
      expect(response.status).toBe(400);
      expect((await response.json()).error).toContain(estado);
    },
  );

  it('responde 404 al cancelar un viaje inexistente', async () => {
    const response = await solicitarCancelacion('no-existe');
    expect(response.status).toBe(404);
  });

  it('responde 503 si falla la base de datos al cancelar', async () => {
    const created = await crearViaje();
    vi.spyOn(viajeRepo, 'cancelarSiCancelable').mockRejectedValueOnce(new Error('TripDB no disponible'));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const response = await solicitarCancelacion(created.id);
    expect(response.status).toBe(503);
  });

  it.each([
    ['', 'cliente', 'El motivo de cancelación es obligatorio'],
    ['   ', 'cliente', 'El motivo de cancelación es obligatorio'],
    ['motivo', 'otro', 'El actor debe ser cliente o conductor'],
  ])('rechaza motivo o actor inválido', async (motivo, actor, error) => {
    const created = await crearViaje();
    const response = await solicitarCancelacion(created.id, { actor, motivo });

    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe(error);
  });
});
