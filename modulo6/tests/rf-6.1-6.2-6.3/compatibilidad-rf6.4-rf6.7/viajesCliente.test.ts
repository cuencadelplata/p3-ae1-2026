import express from 'express';
import type { Server } from 'node:http';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import clientesRoutes from '../../../src/rf-6.1-6.2-6.3/routes/clientes.routes.js';
import conductoresRoutes from '../../../src/rf-6.1-6.2-6.3/routes/conductores.routes.js';
import pool from '../../../src/rf-6.1-6.2-6.3/db/pool.js';
import { EstadoViaje } from '../../../src/rf-6.1-6.2-6.3/models/viaje.model.js';
import * as viajeRepo from '../../../src/rf-6.1-6.2-6.3/repositories/viaje.repository.js';
import viajesRoutes from '../../../src/rf-6.1-6.2-6.3/routes/viajes.routes.js';

const app = express();
app.use(express.json());
app.use('/api/viajes', viajesRoutes);
app.use('/api/clientes', clientesRoutes);
app.use('/api/conductores', conductoresRoutes);

let server: Server;
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

async function crearViaje(clienteId: string): Promise<{ id: string; clienteId: string }> {
  const response = await fetch(`${baseUrl}/api/viajes`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ clienteId, origen: 'Calle A', destino: 'Calle B' }),
  });
  if (!response.ok) throw new Error(`No se pudo crear el viaje de prueba: ${response.status}`);
  return response.json() as Promise<{ id: string; clienteId: string }>;
}

describe('GET /api/clientes/:clienteId/viajes', () => {
  it('devuelve los viajes del cliente con sus transiciones e información de finalización', async () => {
    const clienteId = `cliente-historial-${Date.now()}`;
    const viajeEnCurso = await crearViaje(clienteId);
    const otroViaje = await crearViaje(clienteId);
    await crearViaje(`${clienteId}-distinto`);

    await viajeRepo.actualizarEstado(viajeEnCurso.id, EstadoViaje.CONDUCTOR_EN_CAMINO, 'conductor-test');
    await viajeRepo.actualizarEstado(viajeEnCurso.id, EstadoViaje.ARRIBADO);
    await viajeRepo.actualizarEstado(viajeEnCurso.id, EstadoViaje.EN_CURSO);
    await viajeRepo.finalizarSiEnCurso(viajeEnCurso.id, async (_viaje, inicio) => ({
      inicio,
      horaFin: new Date(inicio.getTime() + 3 * 60_000),
      tiempoMinutos: 3,
      tiempoEstimadoMinutos: 3,
      distanciaKm: 1.11,
      metodoPago: 'tarjeta',
      total: 927.5,
      moneda: 'ARS',
      origen: { latitude: 0, longitude: 0 },
      destino: { latitude: 0, longitude: 0.01 },
      tipoVehiculo: 'auto',
      fuenteMetrica: 'M4',
      metricasEstimadas: true,
      estadoPago: 'autorizado',
      paymentId: `PAY-${viajeEnCurso.id}`,
    }));

    const response = await fetch(`${baseUrl}/api/clientes/${encodeURIComponent(clienteId)}/viajes`);
    const body = await response.json() as {
      clienteId: string;
      viajes: Array<{
        id: string;
        estado: string;
        codigoVerificacion?: string | null;
        qrCode?: string | null;
        finalizacion: { paymentId: string; total: number } | null;
        historialTransiciones: Array<{ from: string | null; to: string; detalle?: string }>;
      }>;
    };

    expect(response.status).toBe(200);
    expect(body.clienteId).toBe(clienteId);
    expect(body.viajes).toHaveLength(2);

    const completed = body.viajes.find((viaje) => viaje.id === viajeEnCurso.id);
    expect(completed).toMatchObject({
      estado: EstadoViaje.COMPLETADO,
      finalizacion: { paymentId: `PAY-${viajeEnCurso.id}`, total: 927.5 },
    });
    expect(completed?.historialTransiciones).toHaveLength(5);
    expect(completed?.historialTransiciones[0]).toMatchObject({ from: null, to: 'solicitado' });
    expect(completed?.historialTransiciones.at(-1)).toMatchObject({
      from: 'en curso',
      to: 'completado',
      detalle: 'Finalización del viaje',
    });

    const requested = body.viajes.find((viaje) => viaje.id === otroViaje.id);
    expect(requested).toMatchObject({ estado: EstadoViaje.SOLICITADO, finalizacion: null });
    expect(requested?.historialTransiciones).toHaveLength(1);
    expect(requested?.historialTransiciones[0]).toMatchObject({ from: null, to: 'solicitado' });
    expect(requested).not.toHaveProperty('codigoVerificacion');
    expect(requested).not.toHaveProperty('qrCode');
  });

  it('devuelve una lista vacía cuando el cliente todavía no tiene viajes', async () => {
    const response = await fetch(`${baseUrl}/api/clientes/sin-viajes/viajes`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ clienteId: 'sin-viajes', viajes: [] });
  });

  it('responde 503 si la consulta de viajes falla', async () => {
    vi.spyOn(viajeRepo, 'buscarViajesPorCliente').mockRejectedValueOnce(new Error('TripDB no disponible'));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const response = await fetch(`${baseUrl}/api/clientes/cliente-error/viajes`);
    expect(response.status).toBe(503);
  });
});

describe('GET /api/conductores/:conductorId/viajes', () => {
  it('devuelve solo viajes asignados al conductor', async () => {
    const conductorId = `conductor-lista-${Date.now()}`;
    const assigned = await crearViaje(`${conductorId}-cliente`);
    const unassigned = await crearViaje(`${conductorId}-otro-cliente`);
    const assignment = await fetch(`${baseUrl}/api/viajes/${assigned.id}/asignar`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ conductorId }),
    });
    expect(assignment.status).toBe(200);

    const response = await fetch(`${baseUrl}/api/conductores/${encodeURIComponent(conductorId)}/viajes`);
    const body = await response.json() as { conductorId: string; viajes: Array<{ id: string; estado: string }> };

    expect(response.status).toBe(200);
    expect(body.conductorId).toBe(conductorId);
    expect(body.viajes).toHaveLength(1);
    expect(body.viajes[0]).toMatchObject({ id: assigned.id, estado: 'CONDUCTOR_EN_CAMINO' });
    expect(body.viajes.some((viaje) => viaje.id === unassigned.id)).toBe(false);
  });

  it('responde 503 si la consulta de viajes falla', async () => {
    vi.spyOn(viajeRepo, 'buscarViajesPorConductor').mockRejectedValueOnce(new Error('TripDB no disponible'));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const response = await fetch(`${baseUrl}/api/conductores/conductor-error/viajes`);
    expect(response.status).toBe(503);
  });
});
