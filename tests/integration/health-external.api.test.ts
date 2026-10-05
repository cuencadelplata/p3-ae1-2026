import { describe, it, expect, vi, afterEach } from 'vitest';
import request from 'supertest';
import { app } from '../../src/app.js';
import { pool } from '../../src/config/db.js';

/** fetch simulado: responde 200 salvo para las URLs que contengan alguno de los fragmentos caídos. */
function stubFetch(down: string[]) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (down.some((fragment) => String(url).includes(fragment))) throw new Error('ECONNREFUSED');
    return new Response('ok', { status: 200 });
  }));
}

describe('GET /health con M6 y Soporte (C9)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('M6 caído → 200 DEGRADED y m6 figura DOWN (no es crítico)', async () => {
    vi.spyOn(pool, 'query').mockResolvedValue({ rows: [] } as never);
    stubFetch(['/m6']);

    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('DEGRADED');
    expect(res.body.checks.m6.status).toBe('DOWN');
    expect(res.body.checks.soporte.status).toBe('UP');
  });

  it('Soporte caído → 200 DEGRADED y soporte figura DOWN', async () => {
    vi.spyOn(pool, 'query').mockResolvedValue({ rows: [] } as never);
    stubFetch(['/soporte']);

    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body.checks.soporte.status).toBe('DOWN');
    expect(res.body.checks.m6.status).toBe('UP');
  });

  it('PostgreSQL caído sigue siendo 503 aunque M6 y Soporte estén bien', async () => {
    vi.spyOn(pool, 'query').mockRejectedValue(new Error('connect ECONNREFUSED'));
    stubFetch([]);

    const res = await request(app).get('/health');

    expect(res.status).toBe(503);
    expect(res.body.checks.postgres.status).toBe('DOWN');
  });
});
