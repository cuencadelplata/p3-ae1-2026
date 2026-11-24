import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createViajeApi, HttpRf6ApiClient } from '../../../src/rf-6.5-6.6/api.js';

const servers: Server[] = [];

async function listen(server: Server): Promise<string> {
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeAllConnections();
  })));
});

async function cancellation(baseUrl: string) {
  const publish = vi.fn();
  const url = await listen(createViajeApi({ rf6Api: new HttpRf6ApiClient(baseUrl), events: { publish } }));
  const response = await fetch(`${url}/api/viajes/V-RED/cancelacion-cliente`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ motivo: 'Cambio de planes' }),
  });
  return { response, publish, url };
}

describe('Cancelaciones - conectividad con la API de Viajes', () => {
  it('responde 503 si no puede conectar con Viajes y mantiene operativo /health', async () => {
    const unavailable = createServer();
    await new Promise<void>((resolve) => unavailable.listen(0, '127.0.0.1', resolve));
    const port = (unavailable.address() as { port: number }).port;
    await new Promise<void>((resolve) => unavailable.close(() => resolve()));

    const { response, publish, url } = await cancellation(`http://127.0.0.1:${port}`);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'No se pudo conectar con la API de Viajes' });
    expect(publish).not.toHaveBeenCalled();
    expect((await fetch(`${url}/health`)).status).toBe(200);
  });

  it.each([404, 409, 503])('conserva el estado %i devuelto por Viajes', async (status) => {
    const baseUrl = await listen(createServer((_request, response) => {
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'Error de Viajes' }));
    }));
    const { response, publish } = await cancellation(baseUrl);
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error: 'Error de Viajes' });
    expect(publish).not.toHaveBeenCalled();
  });

  it('responde 502 si Viajes devuelve un éxito con JSON inválido', async () => {
    const baseUrl = await listen(createServer((_request, response) => response.end('JSON inválido')));
    const { response, publish } = await cancellation(baseUrl);
    expect(response.status).toBe(502);
    expect(publish).not.toHaveBeenCalled();
  });

  it('responde 503 si Viajes falla al persistir la cancelación', async () => {
    const baseUrl = await listen(createServer((request, response) => {
      response.setHeader('content-type', 'application/json');
      if (request.method === 'GET') {
        response.end(JSON.stringify({ id: 'V-RED', clienteId: 'C-RED', estado: 'SOLICITADO' }));
      } else {
        response.statusCode = 503;
        response.end(JSON.stringify({ error: 'Base de datos no disponible' }));
      }
    }));
    const { response, publish } = await cancellation(baseUrl);
    expect(response.status).toBe(503);
    expect(publish).not.toHaveBeenCalled();
  });
});
