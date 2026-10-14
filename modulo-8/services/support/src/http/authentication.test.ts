import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { supportErrorHandler } from './error-handler.js';
import { authenticateWithM1 } from './authentication.js';
import type { IdentityVerifier } from '../integrations/m1-identity.js';

let verificar: ReturnType<typeof vi.fn<IdentityVerifier['verificar']>>;
let app: express.Express;

beforeEach(() => {
  verificar = vi.fn<IdentityVerifier['verificar']>(async () => ({ userId: 7, role: 'CLIENTE' }));
  app = express();
  app.use(authenticateWithM1({ verificar, isReachable: async () => true }));
  app.get('/protegido', (_req, res) => {
    res.json({ actor: res.locals.actor });
  });
  app.use(supportErrorHandler);
});

describe('authenticateWithM1: esquema Bearer', () => {
  it.each(['Bearer', 'bearer', 'BEARER', 'bEaReR'])(
    'acepta el esquema "%s" y lo reenvía a M1 como "Bearer <token>"',
    async (esquema) => {
      const res = await request(app).get('/protegido').set('Authorization', `${esquema} abc.def.ghi`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ actor: 'm1:7' });
      expect(verificar).toHaveBeenCalledWith('Bearer abc.def.ghi');
    },
  );

  it.each([
    ['dos espacios', 'Bearer  abc'],
    ['un tab', 'Bearer\tabc'],
    ['espacios dentro del token', 'Bearer abc def'],
    // Node recorta los espacios del final del valor: llega como "Bearer".
    ['sin token', 'Bearer '],
    ['otro esquema', 'Basic dXNlcg'],
  ])('rechaza %s con 401 SUPPORT_INVALID_TOKEN sin consultar a M1', async (_caso, authorization) => {
    const res = await request(app).get('/protegido').set('Authorization', authorization);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('SUPPORT_INVALID_TOKEN');
    expect(verificar).not.toHaveBeenCalled();
  });
});
