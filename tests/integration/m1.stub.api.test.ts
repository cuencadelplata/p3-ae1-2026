import type { AddressInfo } from 'node:net';
import express, { Router } from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetChaos } from '../../src/stubs/chaos.js';
import { mountStubs } from '../../src/stubs/index.js';

const previousStubsEnabled = process.env.STUBS_ENABLED;

function createStubApp() {
  const stubApp = express();
  stubApp.use(express.json());
  mountStubs(stubApp);
  return stubApp;
}

describe('E3/E4 - Stub HTTP de M1', () => {
  beforeEach(() => {
    process.env.STUBS_ENABLED = 'true';
    resetChaos();
  });

  afterEach(() => {
    resetChaos();
    if (previousStubsEnabled === undefined) {
      delete process.env.STUBS_ENABLED;
    } else {
      process.env.STUBS_ENABLED = previousStubsEnabled;
    }
  });

  it('emite por una hora un JWT HS256 que M1 valida por HTTP', async () => {
    const stubApp = createStubApp();

    const tokenResponse = await request(stubApp)
      .post('/__stubs/m1/auth/token-de-prueba')
      .send({ userId: 12, role: 'CLIENTE' });

    expect(tokenResponse.status).toBe(200);
    expect(tokenResponse.body.expiresIn).toBe(3600);
    expect(typeof tokenResponse.body.token).toBe('string');

    const token = String(tokenResponse.body.token);
    const tokenParts = token.split('.');
    expect(tokenParts).toHaveLength(3);

    const payloadPart = tokenParts[1];
    expect(payloadPart).toBeDefined();
    const payload = JSON.parse(Buffer.from(payloadPart ?? '', 'base64url').toString('utf8'));
    expect(payload).toMatchObject({ userId: 12, role: 'CLIENTE' });
    expect(payload.exp - payload.iat).toBe(3600);

    const validationResponse = await request(stubApp)
      .get('/__stubs/m1/auth/validar-identidad-y-rol')
      .set('Authorization', `Bearer ${token}`);

    expect(validationResponse.status).toBe(200);
    expect(validationResponse.body).toEqual({ valid: true, userId: 12, role: 'CLIENTE' });
  });

  it('rechaza cuerpos externos inválidos y tokens ausentes o manipulados', async () => {
    const stubApp = createStubApp();

    const invalidBody = await request(stubApp)
      .post('/__stubs/m1/auth/token-de-prueba')
      .send({ userId: 0, role: '' });
    const missingToken = await request(stubApp)
      .get('/__stubs/m1/auth/validar-identidad-y-rol');
    const invalidToken = await request(stubApp)
      .get('/__stubs/m1/auth/validar-identidad-y-rol')
      .set('Authorization', 'Bearer header.payload.invalid-signature');

    expect(invalidBody.status).toBe(400);
    expect(invalidBody.body.error).toBe('ValidationError');
    expect(missingToken.status).toBe(401);
    expect(invalidToken.status).toBe(401);
  });

  it('expone health y permite registrar routers futuros sin implementar sus stubs', async () => {
    const stubApp = express();
    stubApp.use(express.json());
    const futureSupportRouter = Router();
    futureSupportRouter.get('/probe', (_req, res) => res.json({ ready: true }));
    mountStubs(stubApp, [{ name: 'soporte', router: futureSupportRouter }]);

    const health = await request(stubApp).get('/__stubs/m1/health');
    const futureProbe = await request(stubApp).get('/__stubs/soporte/probe');

    expect(health.status).toBe(200);
    expect(health.body).toEqual({ status: 'UP', service: 'm1-stub' });
    expect(futureProbe.status).toBe(200);
    expect(futureProbe.body).toEqual({ ready: true });
  });

  it('no monta ningún stub si STUBS_ENABLED no es true', async () => {
    delete process.env.STUBS_ENABLED;
    const stubApp = createStubApp();

    const response = await request(stubApp).get('/__stubs/m1/health');

    expect(response.status).toBe(404);
  });

  it('aplica delay y failRate, y el cuerpo vacío restablece el estado compartido', async () => {
    const stubApp = createStubApp();

    const delayConfiguration = await request(stubApp)
      .post('/__stubs/m1/__chaos')
      .send({ delayMs: 40 });
    const startedAt = Date.now();
    const delayedHealth = await request(stubApp).get('/__stubs/m1/health');
    const elapsedMs = Date.now() - startedAt;

    expect(delayConfiguration.status).toBe(200);
    expect(delayedHealth.status).toBe(200);
    expect(elapsedMs).toBeGreaterThanOrEqual(25);

    await request(stubApp).post('/__stubs/m1/__chaos').send({ failRate: 1 });
    const failedHealth = await request(stubApp).get('/__stubs/m1/health');
    expect(failedHealth.status).toBe(500);

    await request(stubApp).post('/__stubs/m1/__chaos').send({});
    const recoveredHealth = await request(stubApp).get('/__stubs/m1/health');
    expect(recoveredHealth.status).toBe(200);
  });

  it('modo down corta una conexión HTTP real con ECONNRESET y aún permite resetear caos', async () => {
    const stubApp = createStubApp();
    const server = stubApp.listen(0);
    const address = server.address();
    if (address === null || typeof address === 'string') {
      server.close();
      throw new Error('El servidor de prueba no obtuvo un puerto TCP');
    }

    const port = (address satisfies AddressInfo).port;
    const baseUrl = `http://127.0.0.1:${port}/__stubs/m1`;

    try {
      const configureResponse = await fetch(`${baseUrl}/__chaos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'down' })
      });
      expect(configureResponse.status).toBe(200);

      await expect(fetch(`${baseUrl}/health`)).rejects.toThrow();

      const resetResponse = await fetch(`${baseUrl}/__chaos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}'
      });
      expect(resetResponse.status).toBe(200);
      expect((await fetch(`${baseUrl}/health`)).status).toBe(200);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    }
  });
});
