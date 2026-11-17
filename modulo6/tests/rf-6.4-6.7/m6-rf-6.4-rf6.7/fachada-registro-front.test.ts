import type { Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { createViajeApi } from '../../../src/rf-6.4-6.7/api.js';
import { StubViajesApiClient } from './helpers.js';

class StubConBusqueda extends StubViajesApiClient {
  ultimaQuery?: URLSearchParams;

  async buscarViajes(query: URLSearchParams) {
    this.ultimaQuery = query;
    return { status: 200, body: { total: 0, limit: 20, offset: 0, viajes: [] } };
  }
}

async function iniciar(api = new StubConBusqueda()): Promise<{ server: Server; url: string; api: StubConBusqueda }> {
  const server = createViajeApi({ viajesApi: api });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, url: `http://127.0.0.1:${(server.address() as { port: number }).port}`, api };
}

describe('Fachada RF-6.4/6.7 - registro de viajes, front y métricas', () => {
  let server: Server | undefined;
  afterEach(() => { server?.close(); server = undefined; });

  it('reenvía a Viajes sólo los filtros permitidos', async () => {
    const running = await iniciar();
    server = running.server;

    const response = await fetch(`${running.url}/api/viajes?clienteId=c-1&conductorId=d-1&estado=EN_CURSO&limit=5&offset=10&otro=x&sql=1`);

    expect(response.status).toBe(200);
    expect(Object.fromEntries(running.api.ultimaQuery!)).toEqual({
      clienteId: 'c-1', conductorId: 'd-1', estado: 'EN_CURSO', limit: '5', offset: '10',
    });
  });

  it('sirve el front con CSP y sólo los archivos permitidos', async () => {
    const running = await iniciar();
    server = running.server;

    const index = await fetch(`${running.url}/`);
    expect(index.status).toBe(200);
    expect(index.headers.get('content-type')).toContain('text/html');
    expect(index.headers.get('content-security-policy')).toContain("default-src 'self'");
    expect(await index.text()).toContain('Registro de viajes');
    expect(index.headers.get('content-security-policy')).toContain('fonts.gstatic.com');

    expect((await fetch(`${running.url}/registro.js`)).headers.get('content-type')).toContain('javascript');
    expect((await fetch(`${running.url}/registro.css`)).status).toBe(200);
    expect((await fetch(`${running.url}/package.json`)).status).toBe(404);
    expect((await fetch(`${running.url}/..%2fpackage.json`)).status).toBe(404);
  });

  it('expone /metrics y propaga X-Request-Id', async () => {
    const running = await iniciar();
    server = running.server;

    const respuesta = await fetch(`${running.url}/api/viajes/X-1/historial-transiciones`, { headers: { 'x-request-id': 'req-fachada-1' } });
    expect(respuesta.headers.get('x-request-id')).toBe('req-fachada-1');

    const metricas = await (await fetch(`${running.url}/metrics`)).text();
    expect(metricas).toContain('m6_http_requests_total');
    expect(metricas).toContain('route="/api/viajes/:id/historial-transiciones"');
    expect(metricas).not.toContain('X-1');
  });
});
