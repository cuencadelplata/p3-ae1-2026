import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';

import express from 'express';

import { AppError } from '../../src/errors/app-error';
import type { IdentityValidator } from '../../src/middlewares/auth.middleware';
import { createReceiptsModule } from '../../src/module';

const identityValidator: IdentityValidator = async () => {
  throw AppError.unauthorized('INVALID_AUTH_TOKEN', 'El token de autenticacion no es valido');
};

/**
 * Monta el modulo como lo haria la aplicacion comun de M8, junto a rutas de
 * otro modulo, sin base ni Redis: solo se prueban rutas que no los usan.
 */
describe('Modulo de comprobantes montado en una aplicacion comun', () => {
  let server: Server;
  let baseUrl: string;

  before(async () => {
    const receipts = createReceiptsModule({ identityValidator });
    const app = express();
    app.use(receipts.router);
    app.get('/api/v1/qr/ping', (_req, res) => res.json({ module: 'qr' }));
    app.get('/health', (_req, res) => res.json({ module: 'common' }));
    app.use((_req, res) => res.status(404).json({ module: 'common-404' }));

    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
        resolve();
      });
    });
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('no intercepta las rutas de otros modulos ni las comunes', async () => {
    const qr = await fetch(`${baseUrl}/api/v1/qr/ping`);
    assert.equal(qr.status, 200);
    assert.deepEqual(await qr.json(), { module: 'qr' });

    const health = await fetch(`${baseUrl}/health`);
    assert.deepEqual(await health.json(), { module: 'common' });

    const unknown = await fetch(`${baseUrl}/otra/ruta`);
    assert.equal(unknown.status, 404);
    assert.deepEqual(await unknown.json(), { module: 'common-404' });
  });

  it('atiende sus rutas con su propio formato de error y correlationId', async () => {
    const response = await fetch(`${baseUrl}/api/v1/receipts/trip-1`);
    assert.equal(response.status, 401);
    assert.ok(response.headers.get('x-correlation-id'));
    const body = (await response.json()) as { error: { code: string } };
    assert.equal(body.error.code, 'AUTH_REQUIRED');
  });

  it('responde 404 propio para una ruta desconocida bajo /receipts', async () => {
    const response = await fetch(`${baseUrl}/api/v1/receipts/trip-1/otra/cosa`, { method: 'DELETE' });
    assert.equal(response.status, 404);
    const body = (await response.json()) as { error: { code: string } };
    assert.ok(body.error.code);
  });

  it('no publica /health ni /docs propios', async () => {
    const docs = await fetch(`${baseUrl}/docs`);
    assert.equal(docs.status, 404);
    assert.deepEqual(await docs.json(), { module: 'common-404' });
  });
});
