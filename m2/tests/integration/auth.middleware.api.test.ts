import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ServiceUnavailableError } from '../../src/errors/service-unavailable.error.js';
import { requireAuth, requireAuthOrServiceKey } from '../../src/middlewares/auth.middleware.js';
import { errorHandler } from '../../src/middlewares/error-handler.js';
import { m1AuthClient } from '../../src/clients/m1-auth.client.js';

function createProtectedApp(roles?: readonly string[]) {
  const protectedApp = express();
  protectedApp.get('/protected', requireAuth(roles === undefined ? {} : { roles }), (req, res) => {
    res.json(req.auth);
  });
  protectedApp.use(errorHandler);
  return protectedApp;
}

describe('E7 - requireAuth', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('responde 401 si falta Bearer o su formato es inválido', async () => {
    const validateSpy = vi.spyOn(m1AuthClient, 'validateToken');
    const protectedApp = createProtectedApp();

    const missing = await request(protectedApp).get('/protected');
    const malformed = await request(protectedApp)
      .get('/protected')
      .set('Authorization', 'Basic secret');

    expect(missing.status).toBe(401);
    expect(malformed.status).toBe(401);
    expect(validateSpy).not.toHaveBeenCalled();
  });

  it('responde 401 cuando M1 declara inválido el token', async () => {
    vi.spyOn(m1AuthClient, 'validateToken').mockResolvedValue(null);

    const response = await request(createProtectedApp())
      .get('/protected')
      .set('Authorization', 'Bearer invalid-token');

    expect(response.status).toBe(401);
    expect(response.body.error).toBe('Unauthorized');
  });

  it('deja userId, role y el token original en req.auth', async () => {
    vi.spyOn(m1AuthClient, 'validateToken').mockResolvedValue({ userId: 12, role: 'CLIENTE' });

    const response = await request(createProtectedApp(['CLIENTE']))
      .get('/protected')
      .set('Authorization', 'Bearer valid-token');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ userId: 12, role: 'CLIENTE', token: 'valid-token' });
  });

  it('responde 403 si la identidad no tiene el rol requerido', async () => {
    vi.spyOn(m1AuthClient, 'validateToken').mockResolvedValue({ userId: 12, role: 'CONDUCTOR' });

    const response = await request(createProtectedApp(['CLIENTE']))
      .get('/protected')
      .set('Authorization', 'Bearer valid-token');

    expect(response.status).toBe(403);
    expect(response.body.error).toBe('Forbidden');
  });

  it('responde 503 con Retry-After cuando M1 está caído, nunca 401', async () => {
    vi.spyOn(m1AuthClient, 'validateToken')
      .mockRejectedValue(new ServiceUnavailableError('m1 no disponible', 7));

    const response = await request(createProtectedApp())
      .get('/protected')
      .set('Authorization', 'Bearer unknown-while-m1-is-down');

    expect(response.status).toBe(503);
    expect(response.status).not.toBe(401);
    expect(response.headers['retry-after']).toBe('7');
    expect(response.body.error).toBe('ServiceUnavailable');
  });
});

describe('D4 - autenticación de usuarios y servicios', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('acepta la clave de servicio sin crear identidad de usuario', async () => {
    vi.stubEnv('STATUS_SECRET_KEY', 'secret-status');
    const validate = vi.spyOn(m1AuthClient, 'validateToken');
    const protectedApp = express();
    protectedApp.get('/protected', requireAuthOrServiceKey(), (req, res) => res.json({ auth: req.auth ?? null }));

    const response = await request(protectedApp).get('/protected').set('X-Secret-Key', 'secret-status');

    expect(response.status).toBe(200);
    expect(response.body.auth).toBeNull();
    expect(validate).not.toHaveBeenCalled();
  });

  it('rechaza una clave incorrecta y valida el bearer si está presente', async () => {
    vi.stubEnv('STATUS_SECRET_KEY', 'secret-status');
    vi.spyOn(m1AuthClient, 'validateToken').mockResolvedValue({ userId: 12, role: 'CLIENTE' });
    const protectedApp = express();
    protectedApp.get('/protected', requireAuthOrServiceKey(), (req, res) => res.json(req.auth));

    const invalid = await request(protectedApp).get('/protected').set('X-Secret-Key', 'wrong');
    const invalidSameLength = await request(protectedApp).get('/protected').set('X-Secret-Key', 'secret-statux');
    const bearer = await request(protectedApp).get('/protected').set('Authorization', 'Bearer valid-token');

    expect(invalid.status).toBe(401);
    expect(invalidSameLength.status).toBe(401);
    expect(bearer.status).toBe(200);
    expect(bearer.body.userId).toBe(12);
  });

  it('no acepta claves si falta STATUS_SECRET_KEY', async () => {
    vi.stubEnv('STATUS_SECRET_KEY', '');
    const protectedApp = express();
    protectedApp.get('/protected', requireAuthOrServiceKey(), (_req, res) => res.sendStatus(200));

    const response = await request(protectedApp).get('/protected').set('X-Secret-Key', 'secret-status');

    expect(response.status).toBe(401);
  });
});
