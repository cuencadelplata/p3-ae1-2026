import express from 'express';
import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import pool from '../../../src/rf-6.1-6.2-6.3/db/pool.js';
import { EstadoViaje } from '../../../src/rf-6.1-6.2-6.3/models/viaje.model.js';
import * as viajeRepo from '../../../src/rf-6.1-6.2-6.3/repositories/viaje.repository.js';
import viajesRoutes from '../../../src/rf-6.1-6.2-6.3/routes/viajes.routes.js';
import { middlewareObservabilidad } from '../../../src/observabilidad/http.js';
import { registro } from '../../../src/observabilidad/metricas.js';

const app = express();
app.use(middlewareObservabilidad());
app.use(express.json());
app.use('/api/viajes', viajesRoutes);

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
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

beforeEach(async () => {
  await pool.query('TRUNCATE viajes RESTART IDENTITY CASCADE');
});

async function crearViaje(clienteId: string, conductorId?: string): Promise<string> {
  const response = await fetch(`${baseUrl}/api/viajes`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ clienteId, origen: 'Calle A', destino: 'Calle B' }),
  });
  const { id } = await response.json() as { id: string };
  if (conductorId) await viajeRepo.actualizarEstado(id, EstadoViaje.CONDUCTOR_EN_CAMINO, conductorId);
  return id;
}

async function buscar(query: string) {
  const response = await fetch(`${baseUrl}/api/viajes${query}`);
  return { response, body: await response.json() as Record<string, any> };
}

describe('RF-6.7 - Registro de viajes filtrable', () => {
  it('filtra por cliente, por conductor y por estado, con el historial de cada viaje', async () => {
    const v1 = await crearViaje('cli-A', 'cond-1');
    const v2 = await crearViaje('cli-A');
    const v3 = await crearViaje('cli-B', 'cond-1');
    await crearViaje('cli-B', 'cond-2');

    const porCliente = await buscar('?clienteId=cli-A');
    expect(porCliente.response.status).toBe(200);
    expect(porCliente.body.total).toBe(2);
    expect(porCliente.body.viajes.map((v: { id: string }) => v.id).sort()).toEqual([v1, v2].sort());

    const porConductor = await buscar('?conductorId=cond-1');
    expect(porConductor.body.total).toBe(2);
    expect(porConductor.body.viajes.map((v: { id: string }) => v.id).sort()).toEqual([v1, v3].sort());
    const conHistorial = porConductor.body.viajes.find((v: { id: string }) => v.id === v1);
    expect(conHistorial.historialTransiciones.map((t: { to: string }) => t.to)).toEqual(['solicitado', 'conductor en camino']);
    expect(conHistorial).not.toHaveProperty('codigoVerificacion');

    const combinado = await buscar('?clienteId=cli-B&conductorId=cond-1');
    expect(combinado.body.viajes.map((v: { id: string }) => v.id)).toEqual([v3]);

    const porEstado = await buscar('?estado=solicitado');
    expect(porEstado.body.viajes.map((v: { id: string }) => v.id)).toEqual([v2]);
  });

  it('pagina con limit y offset, de más reciente a más antiguo', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 5; i += 1) ids.push(await crearViaje('cli-pag'));

    const primera = await buscar('?clienteId=cli-pag&limit=2');
    const segunda = await buscar('?clienteId=cli-pag&limit=2&offset=2');
    const ultima = await buscar('?clienteId=cli-pag&limit=2&offset=4');

    expect(primera.body).toMatchObject({ total: 5, limit: 2, offset: 0 });
    const vistos = [...primera.body.viajes, ...segunda.body.viajes, ...ultima.body.viajes].map((v: { id: string }) => v.id);
    expect(vistos).toEqual([...ids].reverse());
  });

  it('devuelve lista vacía si no hay coincidencias', async () => {
    const { response, body } = await buscar('?conductorId=nadie');
    expect(response.status).toBe(200);
    expect(body).toEqual({ total: 0, limit: 20, offset: 0, viajes: [] });
  });

  it('valida los parámetros', async () => {
    for (const query of ['?estado=VOLANDO', '?limit=0', '?limit=101', '?offset=-1', '?limit=abc', `?clienteId=${'x'.repeat(51)}`]) {
      const { response } = await buscar(query);
      expect(response.status, query).toBe(400);
    }
  });

  it('expone métricas de las consultas y devuelve X-Request-Id', async () => {
    const { response } = await buscar('?clienteId=cli-metricas');
    expect(response.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);

    const propio = await fetch(`${baseUrl}/api/viajes`, { headers: { 'x-request-id': 'demo-123' } });
    expect(propio.headers.get('x-request-id')).toBe('demo-123');

    const metricas = await registro.metrics();
    expect(metricas).toContain('m6_historial_consultas_total{tipo="registro",resultado="ok"');
    expect(metricas).toMatch(/m6_http_requests_total\{method="GET",route="\/api\/viajes\/",status="200"/);
  });
});
