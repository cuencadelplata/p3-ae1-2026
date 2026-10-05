import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from '../../src/http/app.js';
import { InMemoryDeviceTokenRepository } from '../../src/infrastructure/database/device-token.repository.js';

test('API HTTP de Device Tokens (Protegida con JWT de M1)', async (t) => {
  const tokenRepo = new InMemoryDeviceTokenRepository();
  const handler = createApp({ tokenRepo });

  let server: http.Server;
  let baseUrl: string;

  await new Promise<void>((resolve) => {
    server = http.createServer(handler).listen(0, () => {
      const addr = server.address() as { port: number };
      baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve();
    });
  });

  t.after(() => {
    server.close();
  });

  const validTokenHeader = 'Bearer test-token-usr-0091'; // Token que resuelve userId = usr-0091

  await t.test('POST /devices/tokens sin JWT debe responder 401 Unauthorized', async () => {
    const res = await fetch(`${baseUrl}/devices/tokens`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'device-xyz' }),
    });
    assert.equal(res.status, 401);
  });

  await t.test('POST /devices/tokens con JWT debe registrar el token para el usuario autenticado', async () => {
    const res = await fetch(`${baseUrl}/devices/tokens`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': validTokenHeader,
      },
      body: JSON.stringify({
        token: 'fcm_phone_token_123',
        platform: 'ANDROID',
      }),
    });

    assert.equal(res.status, 201);
    const body = (await res.json()) as { data: { userId: string; token: string; platform: string; isActive: boolean } };
    assert.equal(body.data.userId, 'usr-0091', 'El userId debe derivarse del JWT y no del body');
    assert.equal(body.data.token, 'fcm_phone_token_123');
    assert.equal(body.data.platform, 'ANDROID');
    assert.equal(body.data.isActive, true);
  });

  await t.test('GET /devices/tokens debe listar los tokens del usuario autenticado', async () => {
    const res = await fetch(`${baseUrl}/devices/tokens`, {
      headers: { 'Authorization': validTokenHeader },
    });

    assert.equal(res.status, 200);
    const body = (await res.json()) as { data: Array<{ token: string; isActive: boolean }> };
    assert.equal(body.data.length, 1);
    assert.equal(body.data[0]?.token, 'fcm_phone_token_123');
  });

  await t.test('DELETE /devices/tokens/:token debe desactivar el token indicado', async () => {
    const res = await fetch(`${baseUrl}/devices/tokens/fcm_phone_token_123`, {
      method: 'DELETE',
      headers: { 'Authorization': validTokenHeader },
    });

    assert.equal(res.status, 200);

    // Comprobar que ya no aparece como activo
    const listRes = await fetch(`${baseUrl}/devices/tokens`, {
      headers: { 'Authorization': validTokenHeader },
    });
    const listBody = (await listRes.json()) as { data: Array<{ token: string }> };
    assert.equal(listBody.data.length, 0);
  });
});
