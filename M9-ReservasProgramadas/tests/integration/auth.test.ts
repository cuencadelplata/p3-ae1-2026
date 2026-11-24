import request from 'supertest';
import jwt from 'jsonwebtoken';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Reserva } from '../../src/domain/reserva.js';
import { createApp } from '../../src/app.js';
import { createAuthentication } from '../../src/middleware/auth.middleware.js';
import { InMemoryReservaRepository } from '../../src/repositories/in-memory-reserva.repository.js';
import { ReservaService } from '../../src/services/reserva.service.js';
import { fareEstimate, routeResolverDemo } from '../helpers/route.js';
const secret = 'fixture-only-authentication-secret-32-characters';
const owner = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const body = {
  origen: 'A',
  destino: 'B',
  vehiculo: 'AUTO',
  fechaHoraProgramada: '2099-01-01T00:00:00Z',
};
const token = (sub = owner, options = {}) =>
  jwt.sign({ role: 'CLIENTE' }, secret, { subject: sub, expiresIn: '1h', ...options });
function setup(mode: 'demo' | 'm1' = 'demo') {
  const repository = new InMemoryReservaRepository();
  const entries = new Map<string, Reserva>();
  const cache = {
    get: async (id: string) => entries.get(id) ?? null,
    set: async (reserva: Reserva) => {
      entries.set(reserva.id, reserva);
    },
    invalidate: async (id: string) => {
      entries.delete(id);
    },
  };
  const service = new ReservaService(
    repository,
    { estimar: async () => fareEstimate() },
    routeResolverDemo(),
    cache,
  );
  return {
    repository,
    service,
    app: createApp({
      reservaService: service,
      authenticate: createAuthentication({ mode, demoSecret: secret, m1BaseUrl: 'http://m1.test' }),
    }),
  };
}
afterEach(() => vi.restoreAllMocks());
describe('identidad y propiedad de reservas', () => {
  it.each(['', 'Bearer invalid', 'Basic invalid'])(
    'rechaza credencial ausente o invalida: %s',
    async (authorization) => {
      const { app } = setup();
      expect((await request(app).get('/reservas').set('Authorization', authorization)).status).toBe(
        401,
      );
    },
  );
  it('rechaza JWT vencido, firma ajena, algoritmo incorrecto y rol no cliente', async () => {
    const { app } = setup();
    for (const value of [
      token(owner, { expiresIn: -1 }),
      jwt.sign({ sub: owner, role: 'CLIENTE' }, 'other-fixture-secret'),
      token(owner, { algorithm: 'HS384' }),
    ])
      expect((await request(app).get('/reservas').auth(value, { type: 'bearer' })).status).toBe(
        401,
      );
    expect(
      (
        await request(app)
          .get('/reservas')
          .auth(
            jwt.sign(
              { sub: owner, role: 'CONDUCTOR', exp: Math.floor(Date.now() / 1000) + 60 },
              secret,
            ),
            { type: 'bearer' },
          )
      ).status,
    ).toBe(403);
  });
  it('obtiene el cliente del token y rechaza suplantacion en el body', async () => {
    const { app } = setup();
    const created = await request(app)
      .post('/reservas')
      .auth(token(), { type: 'bearer' })
      .send(body);
    expect(created.status).toBe(201);
    expect(created.body.clienteId).toBe(owner);
    expect(
      (
        await request(app)
          .post('/reservas')
          .auth(token(), { type: 'bearer' })
          .send({ ...body, clienteId: other })
      ).status,
    ).toBe(403);
  });
  it('niega consulta, modificacion y cancelacion ajenas, incluso con cache caliente', async () => {
    const { app, repository } = setup();
    const created = await request(app)
      .post('/reservas')
      .auth(token(), { type: 'bearer' })
      .send(body);
    await request(app)
      .get('/reservas/' + created.body.id)
      .auth(token(), { type: 'bearer' })
      .expect(200);
    await request(app)
      .get('/reservas/' + created.body.id)
      .auth(token(other), { type: 'bearer' })
      .expect(404);
    await request(app)
      .patch('/reservas/' + created.body.id)
      .auth(token(other), { type: 'bearer' })
      .send({ destino: 'C' })
      .expect(404);
    await request(app)
      .delete('/reservas/' + created.body.id)
      .auth(token(other), { type: 'bearer' })
      .expect(404);
    expect(await repository.obtenerPorId(created.body.id)).toMatchObject({
      destino: 'B',
      estado: 'PROGRAMADA',
    });
  });
  it('filtra el propietario antes de paginar', async () => {
    const { app } = setup();
    for (const sub of [owner, other, owner])
      await request(app)
        .post('/reservas')
        .auth(token(sub), { type: 'bearer' })
        .send(body)
        .expect(201);
    for (const page of [1, 2]) {
      const response = await request(app)
        .get('/reservas?page=' + page + '&pageSize=1')
        .auth(token(), { type: 'bearer' });
      expect(response.body.reservas).toHaveLength(1);
      expect(response.body.reservas[0].clienteId).toBe(owner);
    }
  });
  it('acepta la identidad numerica validada por M1 y envia el Bearer al endpoint oficial', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify({ valid: true, userId: 101, role: 'CLIENTE' })),
      );
    const { app } = setup('m1');
    const created = await request(app)
      .post('/reservas')
      .auth('opaque-m1-token', { type: 'bearer' })
      .send(body);
    expect(created.status).toBe(201);
    expect(created.body.clienteId).toBe('101');
    expect(String(fetchMock.mock.calls[0]![0])).toBe('http://m1.test/auth/validar-identidad-y-rol');
  });
  it('falla cerrado si M1 rechaza, revoca o no responde', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    const { app } = setup('m1');
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ valid: false })));
    await request(app).get('/reservas').auth('revoked', { type: 'bearer' }).expect(401);
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    await request(app).get('/reservas').auth('unverified', { type: 'bearer' }).expect(503);
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 401 }));
    await request(app).get('/reservas').auth('expired', { type: 'bearer' }).expect(401);
  });
});

describe('fallos de configuracion e identidad de M1', () => {
  it('rechaza demo sin clave, JWT sin exp y payload de texto', async () => {
    await request(createApp({ authenticate: createAuthentication({ mode: 'demo' }) }))
      .get('/session')
      .auth('opaque', { type: 'bearer' })
      .expect(503);
    const { app } = setup();
    for (const value of [
      jwt.sign({ sub: owner, role: 'CLIENTE' }, secret),
      jwt.sign('payload-string', secret),
    ])
      await request(app).get('/session').auth(value, { type: 'bearer' }).expect(401);
  });
  it('rechaza fallos HTTP, JSON invalido e identidad incorrecta del servicio M1', async () => {
    const mock = vi.spyOn(globalThis, 'fetch');
    const { app } = setup('m1');
    for (const [response, status] of [
      [new Response('{}', { status: 500 }), 503],
      [new Response('not-json'), 503],
      [new Response(JSON.stringify({ valid: true, userId: 0, role: 'CLIENTE' })), 401],
      [new Response(JSON.stringify({ valid: true, userId: 101, role: 'CONDUCTOR' })), 403],
    ] as const) {
      mock.mockResolvedValueOnce(response);
      await request(app).get('/session').auth('opaque', { type: 'bearer' }).expect(status);
    }
  });
});
