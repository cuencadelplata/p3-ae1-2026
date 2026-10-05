import { describe, it, expect, vi, afterEach } from 'vitest';
import { M6Client } from '../../src/clients/m6.client.js';
import { SoporteClient } from '../../src/clients/soporte.client.js';
import { ServiceUnavailableError } from '../../src/errors/service-unavailable.error.js';
import { checkM6, checkSoporte } from '../../src/health/external-checks.js';
import type { ResiliencePolicy } from '../../src/resilience/policies.js';

// Política sin timeout ni circuito: ejecuta la operación tal cual
const passthrough: ResiliencePolicy = {
  execute: (operation) => operation(new AbortController().signal)
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

// createPolicy guarda un circuito por dependencia en el proceso: cada test que lo usa
// carga módulos nuevos para no heredar fallas ni variables de otro test.
async function freshClients() {
  vi.resetModules();
  const { createPolicy } = await import('../../src/resilience/policies.js');
  const { ServiceUnavailableError: Unavailable } = await import('../../src/errors/service-unavailable.error.js');
  const { M6Client: M6 } = await import('../../src/clients/m6.client.js');
  const { SoporteClient: Soporte } = await import('../../src/clients/soporte.client.js');
  return { createPolicy, Unavailable, M6, Soporte };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('M6Client (C8)', () => {
  it('ejecuta la consulta dentro de la política m6 como idempotente', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ userId: 12, tripsCount: 0, trips: [] })));
    const policy = { execute: vi.fn(passthrough.execute) } as ResiliencePolicy;

    await new M6Client('http://m6', policy).getTrips(12, 'tok');

    expect(policy.execute).toHaveBeenCalledWith(expect.any(Function), { idempotent: true });
  });

  it('un 5xx de M6 → ServiceUnavailableError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('boom', { status: 500 })));
    await expect(new M6Client('http://m6', passthrough).getTrips(12, 'tok'))
      .rejects.toBeInstanceOf(ServiceUnavailableError);
  });

  it('el timeout de la política → ServiceUnavailableError', async () => {
    vi.stubEnv('M6_POLICY_TIMEOUT_MS', '20');
    vi.stubEnv('RESILIENCE_RETRY_ATTEMPTS', '0');
    // fetch que nunca responde, solo termina cuando la política lo cancela
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => new Promise((_, reject) => {
      init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    })));

    const { createPolicy, Unavailable, M6 } = await freshClients();

    await expect(new M6('http://m6', createPolicy('m6')).getTrips(12, 'tok'))
      .rejects.toBeInstanceOf(Unavailable);
  });

  it('tras 3 fallas el circuito se abre y ya no se llama a M6', async () => {
    vi.stubEnv('RESILIENCE_RETRY_ATTEMPTS', '0');
    const fetchMock = vi.fn().mockResolvedValue(new Response('boom', { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);
    const { createPolicy, Unavailable, M6 } = await freshClients();
    const client = new M6('http://m6', createPolicy('m6'));

    for (let i = 0; i < 3; i++) {
      await expect(client.getTrips(12, 'tok')).rejects.toBeInstanceOf(Unavailable);
    }
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await expect(client.getTrips(12, 'tok')).rejects.toBeInstanceOf(Unavailable);

    expect(fetchMock).toHaveBeenCalledTimes(3); // circuito abierto: no se llamó a M6
  });
});

describe('SoporteClient (C8)', () => {
  it('envía la clave de servicio y usa la política soporte como idempotente', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ userId: 12, total: 0, penalizaciones: [] }));
    vi.stubGlobal('fetch', fetchMock);
    const policy = { execute: vi.fn(passthrough.execute) } as ResiliencePolicy;

    await new SoporteClient('http://soporte', 'clave', policy).getPenalizaciones(12);

    expect(fetchMock.mock.calls[0][1].headers).toEqual({ 'X-Secret-Key': 'clave' });
    expect(policy.execute).toHaveBeenCalledWith(expect.any(Function), { idempotent: true });
  });

  it('un 5xx de Soporte → ServiceUnavailableError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('boom', { status: 503 })));
    await expect(new SoporteClient('http://soporte', 'k', passthrough).getPenalizaciones(12))
      .rejects.toBeInstanceOf(ServiceUnavailableError);
  });

  it('un 401 de Soporte no se trata como caída', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('no', { status: 401 })));
    const error = await new SoporteClient('http://soporte', 'k', passthrough)
      .getPenalizaciones(12).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(ServiceUnavailableError);
  });

  it('tras 3 fallas el circuito se abre y ya no se llama a Soporte', async () => {
    vi.stubEnv('RESILIENCE_RETRY_ATTEMPTS', '0');
    const fetchMock = vi.fn().mockResolvedValue(new Response('boom', { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);
    const { createPolicy, Unavailable, Soporte } = await freshClients();
    const client = new Soporte('http://soporte', 'k', createPolicy('soporte'));

    for (let i = 0; i < 3; i++) {
      await expect(client.getPenalizaciones(12)).rejects.toBeInstanceOf(Unavailable);
    }
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await expect(client.getPenalizaciones(12)).rejects.toBeInstanceOf(Unavailable);

    expect(fetchMock).toHaveBeenCalledTimes(3); // circuito abierto: no se llamó a Soporte
  });
});

describe('Chequeos de salud externos (C9)', () => {
  it('devuelven boolean: true si el módulo responde', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('ok', { status: 200 })));
    expect(await checkM6()).toBe(true);
    expect(await checkSoporte()).toBe(true);
  });

  it('devuelven false (no un objeto) si el módulo está caído', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    expect(await checkM6()).toBe(false);
    expect(await checkSoporte()).toBe(false);
  });
});

describe('Fallas de red de fetch (C8)', () => {
  const socketError = Object.assign(new TypeError('fetch failed'), {
    cause: Object.assign(new Error('other side closed'), { code: 'UND_ERR_SOCKET' })
  });

  it('M6: un socket cortado → ServiceUnavailableError (no un 500)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(socketError));
    await expect(new M6Client('http://m6', passthrough).getTrips(12, 'tok'))
      .rejects.toBeInstanceOf(ServiceUnavailableError);
  });

  it('Soporte: un socket cortado → ServiceUnavailableError (no un 500)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(socketError));
    await expect(new SoporteClient('http://soporte', 'k', passthrough).getPenalizaciones(12))
      .rejects.toBeInstanceOf(ServiceUnavailableError);
  });
});
