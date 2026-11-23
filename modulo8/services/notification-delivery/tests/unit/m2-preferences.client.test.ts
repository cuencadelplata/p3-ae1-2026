import test from 'node:test';
import assert from 'node:assert/strict';

import { HttpM2PreferencesClient, M2PreferencesError } from '../../src/infrastructure/clients/m2-preferences.client.js';

test('un 404 de M2 no habilita PUSH por defecto', async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(null, { status: 404 });
  try {
    const client = new HttpM2PreferencesClient('http://m2', 'test-key');
    await assert.rejects(client.getPreferences(42, 'doc-42'), (error: unknown) =>
      error instanceof M2PreferencesError && error.code === 'CONFIGURATION');
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('un formato de preferencias no acordado tampoco habilita PUSH', async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ preferences: { notificationChannel: 'push' } });
  try {
    const client = new HttpM2PreferencesClient('http://m2', 'test-key');
    await assert.rejects(client.getPreferences(42, 'doc-42'), /formato inválido/);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('M2 distingue cliente inexistente de ruta inexistente', async () => {
  const previousFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => Response.json({ error: 'CustomerNotFound' }, { status: 404 });
    const client = new HttpM2PreferencesClient('http://m2:3000', 'test-key');
    await assert.rejects(client.getPreferences(42, 'corr-42'), (error: unknown) =>
      error instanceof M2PreferencesError && error.code === 'CUSTOMER_NOT_FOUND');
    globalThis.fetch = async () => Response.json({ error: 'NotFound' }, { status: 404 });
    await assert.rejects(client.getPreferences(42, 'corr-42'), (error: unknown) =>
      error instanceof M2PreferencesError && error.code === 'CONFIGURATION');
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('M2 clasifica 401 como configuración y 503 como indisponibilidad', async () => {
  const previousFetch = globalThis.fetch;
  try {
    const client = new HttpM2PreferencesClient('http://m2:3000', 'test-key');
    globalThis.fetch = async () => Response.json({ error: 'Unauthorized' }, { status: 401 });
    await assert.rejects(client.getPreferences(42, 'corr-42'), (error: unknown) =>
      error instanceof M2PreferencesError && error.code === 'CONFIGURATION');
    globalThis.fetch = async () => Response.json({ error: 'Unavailable' }, { status: 503 });
    await assert.rejects(client.getPreferences(42, 'corr-42'), (error: unknown) =>
      error instanceof M2PreferencesError && error.code === 'UNAVAILABLE');
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('M2 acepta la respuesta propuesta y envía los headers acordados', async () => {
  const previousFetch = globalThis.fetch;
  let headers: Headers | undefined;
  try {
    globalThis.fetch = async (_input, init) => {
      headers = new Headers(init?.headers);
      return Response.json({ userId: 91, notificationsEnabled: true, pushEnabled: false, notificationChannel: 'email' });
    };
    const client = new HttpM2PreferencesClient('http://m2:3000', 'test-key');
    const result = await client.getPreferences(91, 'corr-91');
    assert.deepEqual(result, { userId: 91, notificationsEnabled: true, pushEnabled: false });
    assert.equal(headers?.get('x-api-key'), 'test-key');
    assert.equal(headers?.get('x-correlation-id'), 'corr-91');
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('un timeout de M2 queda disponible para retry', async () => {
  const previousFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (_input, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    });
    const client = new HttpM2PreferencesClient('http://m2:3000', 'test-key', 1);
    await assert.rejects(client.getPreferences(42, 'corr-42'), (error: unknown) =>
      error instanceof M2PreferencesError && error.code === 'UNAVAILABLE');
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('el circuit breaker deja de consultar a M2 tras fallas seguidas y vuelve a probar al vencer', async () => {
  const { CircuitBreakerM2PreferencesClient } = await import('../../src/infrastructure/clients/m2-preferences.client.js');
  let calls = 0;
  let up = false;
  const inner = {
    async getPreferences(userId: number) {
      calls += 1;
      if (!up) throw new M2PreferencesError('UNAVAILABLE', 'M2 caido');
      return { userId, notificationsEnabled: true, pushEnabled: true };
    },
  };
  let now = 0;
  const breaker = new CircuitBreakerM2PreferencesClient(inner, { failureThreshold: 3, openMs: 1000, now: () => now });

  for (let i = 0; i < 3; i += 1) await assert.rejects(breaker.getPreferences(7, 'c'));
  assert.equal(breaker.state(), 'open');
  assert.equal(calls, 3);

  // Abierto: falla al instante como UNAVAILABLE (reintentable) sin llamar a M2.
  await assert.rejects(breaker.getPreferences(7, 'c'), (error: unknown) =>
    error instanceof M2PreferencesError && error.code === 'UNAVAILABLE');
  assert.equal(calls, 3);

  // Vencido el tiempo, una prueba: si M2 volvió, se cierra.
  now = 1000;
  up = true;
  const preferences = await breaker.getPreferences(7, 'c');
  assert.equal(preferences.pushEnabled, true);
  assert.equal(breaker.state(), 'closed');
  assert.equal(calls, 4);
});

test('un error de negocio de M2 no abre el circuito', async () => {
  const { CircuitBreakerM2PreferencesClient } = await import('../../src/infrastructure/clients/m2-preferences.client.js');
  const inner = {
    async getPreferences(): Promise<never> {
      throw new M2PreferencesError('CUSTOMER_NOT_FOUND', 'sin perfil');
    },
  };
  const breaker = new CircuitBreakerM2PreferencesClient(inner, { failureThreshold: 1 });
  await assert.rejects(breaker.getPreferences(7, 'c'));
  await assert.rejects(breaker.getPreferences(7, 'c'));
  assert.equal(breaker.state(), 'closed');
});
