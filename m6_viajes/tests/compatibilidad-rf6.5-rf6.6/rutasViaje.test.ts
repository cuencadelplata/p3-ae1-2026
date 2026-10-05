import express from 'express';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import pool from '../../src/db/pool.js';
import * as viajeRepo from '../../src/repositories/viaje.repository.js';
import viajesRoutes from '../../src/routes/viajes.routes.js';

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
  it('GET devuelve el viaje directamente con los campos de integración', async () => {
    const created = await crearViaje();
    const response = await fetch(`${baseUrl}/api/viajes/${created.id}`);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      id: created.id,
      clienteId: created.clienteId,
      conductorId: null,
      estado: 'SOLICITADO',
    });
    expect(body).not.toHaveProperty('viaje');
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
    expect(body).toEqual({
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
