import express from 'express';
import supertest from 'supertest';
import { describe, expect, it } from 'vitest';
import { correlationMiddleware } from '../../src/infrastructure/http/middlewares/correlation.middleware.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const buildClient = () => {
  const app = express();
  app.use(correlationMiddleware);
  app.get('/ping', (_req, res) => {
    res.status(200).json({ ok: true });
  });
  return supertest(app);
};

describe('correlationMiddleware (RNF-16)', () => {
  it('debe reutilizar un X-Correlation-ID valido recibido', async () => {
    const res = await buildClient().get('/ping').set('X-Correlation-ID', 'm5-dispatch-123');

    expect(res.headers['x-correlation-id']).toBe('m5-dispatch-123');
  });

  it('debe generar un UUID cuando no se envia el header', async () => {
    const res = await buildClient().get('/ping');

    expect(res.headers['x-correlation-id']).toMatch(UUID_PATTERN);
  });

  it('debe reemplazar un X-Correlation-ID con caracteres no permitidos o demasiado largo', async () => {
    const client = buildClient();

    const withSpaces = await client.get('/ping').set('X-Correlation-ID', 'id con espacios <script>');
    expect(withSpaces.headers['x-correlation-id']).toMatch(UUID_PATTERN);

    const tooLong = await client.get('/ping').set('X-Correlation-ID', 'a'.repeat(200));
    expect(tooLong.headers['x-correlation-id']).toMatch(UUID_PATTERN);
  });
});
