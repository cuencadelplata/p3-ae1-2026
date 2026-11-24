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

  it.each([
    ['SOLICITADO', 'cliente'],
    ['CONDUCTOR_EN_CAMINO', 'conductor'],
  ])('cancela atómicamente un viaje en estado %s y devuelve el viaje directamente', async (estado, actor) => {
    const created = await crearViaje();
    if (estado === 'CONDUCTOR_EN_CAMINO') {
      const assignment = await fetch(`${baseUrl}/api/viajes/${created.id}/asignar`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ conductorId: 'conductor-test' }),
      });
      expect(assignment.status).toBe(200);
    }

    const response = await solicitarCancelacion(created.id, { actor, motivo: 'Cancelación de prueba' });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      id: created.id,
      clienteId: created.clienteId,
      conductorId: estado === 'CONDUCTOR_EN_CAMINO' ? 'conductor-test' : null,
      estado: 'CANCELADO',
    });
    expect(body).not.toHaveProperty('viaje');
  });

  it.each(['ASIGNADO', 'ARRIBADO', 'EN_CURSO', 'COMPLETADO', 'CANCELADO'])(
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
