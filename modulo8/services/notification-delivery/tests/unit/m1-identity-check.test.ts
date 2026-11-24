import test from 'node:test';
import assert from 'node:assert/strict';

import { createM1IdentityCheck } from '../../src/http/auth/m1-auth.middleware.js';

const endpoint = 'http://m1.test/auth/validar-identidad-y-rol';
const respond = (status: number, body?: unknown): typeof fetch =>
  async () => new Response(body === undefined ? null : JSON.stringify(body), { status });

test('Confirmación de identidad con M1', async (t) => {
  await t.test('un usuario activo pasa y se reenvía el Bearer recibido', async () => {
    let authorization = '';
    const check = createM1IdentityCheck(endpoint, 100, async (_url, options) => {
      authorization = new Headers(options?.headers).get('authorization') ?? '';
      return new Response(JSON.stringify({ valid: true, userId: 79, role: 'CLIENTE' }), { status: 200 });
    });
    assert.equal(await check('Bearer token-de-m1'), 'active');
    assert.equal(authorization, 'Bearer token-de-m1');
  });

  await t.test('un usuario bloqueado o inexistente (valid: false) no pasa', async () => {
    assert.equal(await createM1IdentityCheck(endpoint, 100, respond(200, { valid: false, userId: 79 }))('Bearer t'), 'inactive');
  });

  await t.test('credenciales revocadas (401) no pasan', async () => {
    assert.equal(await createM1IdentityCheck(endpoint, 100, respond(401))('Bearer t'), 'inactive');
  });

  await t.test('M1 caído o con error se informa como no disponible', async () => {
    assert.equal(await createM1IdentityCheck(endpoint, 100, respond(500))('Bearer t'), 'unavailable');
    const caido = createM1IdentityCheck(endpoint, 100, async () => { throw new Error('ECONNREFUSED'); });
    assert.equal(await caido('Bearer t'), 'unavailable');
  });
});
