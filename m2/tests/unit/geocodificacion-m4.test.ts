import express from 'express';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// La ruta sólo necesita el router; la base y Redis no se usan en geocodificación.
vi.mock('../../src/config/prisma', () => ({ prisma: {} }));
vi.mock('../../src/config/redis', () => ({ redisClient: {} }));
vi.mock('@prisma/client', () => ({ Prisma: {}, PrismaClient: class {} }));

import { router } from '../../src/direcciones/routes';
import { ApiError } from '../../src/direcciones/domain';

// M4 falso con el contrato real de modulo-4: POST /api/v1/geocode {address}.
const m4 = express();
m4.use(express.json());
m4.post('/api/v1/geocode', (req, res) => {
  const address = String(req.body?.address ?? '');
  if (address === 'Plaza 25 de Mayo') return res.json({ address: 'Plaza 25 de Mayo, Corrientes', latitude: -27.4684, longitude: -58.8341, provider: 'SIMULATED' });
  if (address === 'trigger-timeout') return res.status(504).json({ code: 'GEOCODING_TIMEOUT' });
  return res.status(404).json({ code: 'NOT_FOUND' });
});

const app = express();
app.use((_req, res, next) => { res.locals.correlationId = 'test'; next(); });
app.use(router);
app.use(((err, _req, res, _next) => {
  res.status(err instanceof ApiError ? err.status : 500).json({ code: err.code });
}) as express.ErrorRequestHandler);

let server: ReturnType<typeof m4.listen>;
beforeAll(async () => {
  server = m4.listen(0);
  await new Promise((r) => server.once('listening', r));
  process.env.M4_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => { server.close(); });

describe('Geocodificación contra el contrato real de M4', () => {
  it('traduce {address, latitude, longitude} al formato de M2', async () => {
    const res = await request(app).get('/geocodificacion').query({ q: 'Plaza 25 de Mayo' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: [{ direccion: 'Plaza 25 de Mayo, Corrientes', latitud: -27.4684, longitud: -58.8341 }] });
  });

  it('una dirección que M4 no encuentra (404) es una lista vacía, no un error', async () => {
    const res = await request(app).get('/geocodificacion').query({ q: 'Calle que no existe' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: [] });
  });

  it('timeout o caída de M4 responde 503 MAPS_UNAVAILABLE', async () => {
    expect((await request(app).get('/geocodificacion').query({ q: 'trigger-timeout' })).status).toBe(503);
    const saved = process.env.M4_BASE_URL;
    process.env.M4_BASE_URL = 'http://127.0.0.1:1';
    const res = await request(app).get('/geocodificacion').query({ q: 'Plaza 25 de Mayo' });
    process.env.M4_BASE_URL = saved;
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('MAPS_UNAVAILABLE');
  });
});
