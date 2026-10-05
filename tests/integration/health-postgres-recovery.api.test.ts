import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('GET /health tras recuperar PostgreSQL', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('cierra el circuito sin esperar otra petición a la base', async () => {
    vi.stubEnv('CIRCUIT_BREAKER_THRESHOLD', '1');
    vi.stubEnv('CIRCUIT_BREAKER_RESET_MS', '50');
    vi.stubEnv('RESILIENCE_RETRY_ATTEMPTS', '0');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('ok', { status: 200 })));
    vi.resetModules();

    const [{ app }, { pool }, { getCircuitStates }, { ServiceUnavailableError }] = await Promise.all([
      import('../../src/app.js'),
      import('../../src/config/db.js'),
      import('../../src/resilience/policies.js'),
      import('../../src/errors/service-unavailable.error.js')
    ]);
    vi.spyOn(pool, 'query')
      .mockRejectedValueOnce(new ServiceUnavailableError('postgres down'))
      .mockResolvedValue({ rows: [] } as never);

    const failedRead = await request(app).get('/v1/customers');
    expect(failedRead.status).toBe(503);
    expect(getCircuitStates().postgres).toBe('open');

    await new Promise((resolve) => setTimeout(resolve, 100));
    const recoveredHealth = await request(app).get('/health');

    expect(recoveredHealth.body.checks.postgres.status).toBe('UP');
    expect(recoveredHealth.body.circuits.postgres).toBe('closed');
    expect(recoveredHealth.status).toBe(200);
  });
});
