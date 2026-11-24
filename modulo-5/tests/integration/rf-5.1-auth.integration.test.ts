import request from 'supertest';
import { createHmac } from 'node:crypto';
import { app } from '../../src/index';

/**
 * RF-5.1 — Seguridad HTTP (RNF-10) e idempotencia entre clientes (RNF-08).
 * Corre con AUTH_MODE=jwt (autenticación real), a diferencia del resto de la suite
 * que usa identidad simulada por header.
 */
describe('RF-5.1 — autenticación e idempotencia por cliente (HTTP)', () => {
  const SECRET = 'secreto-de-prueba-rf51';
  const previousMode = process.env.AUTH_MODE;
  const previousSecret = process.env.JWT_SECRET;

  const token = (sub: string, expOffsetSeconds = 300, secret = SECRET) => {
    const head = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(
      JSON.stringify({ sub, exp: Math.floor(Date.now() / 1000) + expOffsetSeconds })
    ).toString('base64url');
    const signature = createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url');
    return `${head}.${body}.${signature}`;
  };

  const unique = (prefix: string) => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const validPayload = {
    origin: { latitude: -34.6037, longitude: -58.3816, address: 'Av. 9 de Julio y Corrientes (Obelisco)' },
    destination: { latitude: -34.5885, longitude: -58.3974, address: 'Av. Alvear 1891 (Recoleta)' },
    vehicleType: 'AUTO'
  };

  beforeAll(() => {
    process.env.AUTH_MODE = 'jwt';
    process.env.JWT_SECRET = SECRET;
  });

  afterAll(() => {
    if (previousMode === undefined) delete process.env.AUTH_MODE;
    else process.env.AUTH_MODE = previousMode;
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
  });

  it('RF-5.1 responde 401 sin token', async () => {
    const res = await request(app)
      .post('/api/v1/ride-requests')
      .set('Idempotency-Key', unique('key'))
      .send(validPayload);

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHENTICATED');
  });

  it('RF-5.1 responde 401 con un token inválido o vencido', async () => {
    const forged = await request(app)
      .post('/api/v1/ride-requests')
      .set('Authorization', `Bearer ${token('user_1', 300, 'otro-secreto')}`)
      .set('Idempotency-Key', unique('key'))
      .send(validPayload);
    const expired = await request(app)
      .post('/api/v1/ride-requests')
      .set('Authorization', `Bearer ${token('user_1', -10)}`)
      .set('Idempotency-Key', unique('key'))
      .send(validPayload);

    expect(forged.status).toBe(401);
    expect(forged.body.code).toBe('INVALID_TOKEN');
    expect(expired.status).toBe(401);
    expect(expired.body.code).toBe('INVALID_TOKEN');
  });

  it('RF-5.1 ignora x-user-id: la identidad sale del token validado', async () => {
    const userId = unique('user');
    const res = await request(app)
      .post('/api/v1/ride-requests')
      .set('Authorization', `Bearer ${token(userId)}`)
      .set('x-user-id', 'atacante')
      .set('Idempotency-Key', unique('key'))
      .send(validPayload);

    expect(res.status).toBe(201);
    expect(res.body.clientId).toBe(userId);
  });

  it('RF-5.1 falla cerrado (503) si el servicio no tiene JWT_SECRET configurado', async () => {
    delete process.env.JWT_SECRET;
    try {
      const res = await request(app)
        .post('/api/v1/ride-requests')
        .set('Authorization', `Bearer ${token('user_1')}`)
        .set('Idempotency-Key', unique('key'))
        .send(validPayload);
      expect(res.status).toBe(503);
      expect(res.body.code).toBe('AUTH_NOT_CONFIGURED');
    } finally {
      process.env.JWT_SECRET = SECRET;
    }
  });

  it('RF-5.1 la misma Idempotency-Key en dos clientes no devuelve la solicitud ajena', async () => {
    const sharedKey = unique('shared');
    const userA = unique('user_a');
    const userB = unique('user_b');

    const resA = await request(app)
      .post('/api/v1/ride-requests')
      .set('Authorization', `Bearer ${token(userA)}`)
      .set('Idempotency-Key', sharedKey)
      .send(validPayload);
    const resB = await request(app)
      .post('/api/v1/ride-requests')
      .set('Authorization', `Bearer ${token(userB)}`)
      .set('Idempotency-Key', sharedKey)
      .send(validPayload);

    expect(resA.status).toBe(201);
    expect(resB.status).toBe(201);
    expect(resB.body.id).not.toBe(resA.body.id);
    expect(resB.body.clientId).toBe(userB);
  });

  it('RF-5.1 reintentar con el mismo token y la misma clave devuelve la solicitud original', async () => {
    const userId = unique('user');
    const key = unique('key');

    const first = await request(app)
      .post('/api/v1/ride-requests')
      .set('Authorization', `Bearer ${token(userId)}`)
      .set('Idempotency-Key', key)
      .send(validPayload);
    const second = await request(app)
      .post('/api/v1/ride-requests')
      .set('Authorization', `Bearer ${token(userId)}`)
      .set('Idempotency-Key', key)
      .send(validPayload);

    expect(second.body.id).toBe(first.body.id);
  });

  it('RF-5.1 la misma clave con otro contenido responde 409 IDEMPOTENCY_KEY_REUSED', async () => {
    const userId = unique('user');
    const key = unique('key');

    await request(app)
      .post('/api/v1/ride-requests')
      .set('Authorization', `Bearer ${token(userId)}`)
      .set('Idempotency-Key', key)
      .send(validPayload);
    const res = await request(app)
      .post('/api/v1/ride-requests')
      .set('Authorization', `Bearer ${token(userId)}`)
      .set('Idempotency-Key', key)
      .send({ ...validPayload, vehicleType: 'MOTO' });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it.each(['POST', 'DELETE'])('cancelación %s exige JWT y comprueba propiedad aunque se falsifique x-user-id', async (method) => {
    const owner = unique('owner_cancel');
    const created = await request(app).post('/api/v1/ride-requests')
      .set('Authorization', `Bearer ${token(owner)}`)
      .set('Idempotency-Key', unique('key')).send(validPayload);
    expect(created.status).toBe(201);
    const path = `/api/v1/ride-requests/${created.body.id}${method === 'POST' ? '/cancel' : ''}`;
    const call = () => method === 'POST' ? request(app).post(path) : request(app).delete(path);
    expect((await call().set('x-user-id', owner).send({})).status).toBe(401);
    expect((await call().set('Authorization', `Bearer ${token(unique('intruso'))}`)
      .set('x-user-id', owner).send({})).status).toBe(403);
    expect((await call().set('Authorization', `Bearer ${token(owner)}`)
      .set('x-user-id', 'identidad-falsa').send({})).status).toBe(200);
  });

  it('RF-5.1 GET exige token y no deja leer la solicitud de otro cliente', async () => {
    const owner = unique('owner');
    const other = unique('other');

    const created = await request(app)
      .post('/api/v1/ride-requests')
      .set('Authorization', `Bearer ${token(owner)}`)
      .set('Idempotency-Key', unique('key'))
      .send(validPayload);

    const withoutToken = await request(app).get(`/api/v1/ride-requests/${created.body.id}`);
    const asOther = await request(app)
      .get(`/api/v1/ride-requests/${created.body.id}`)
      .set('Authorization', `Bearer ${token(other)}`);
    const asOwner = await request(app)
      .get(`/api/v1/ride-requests/${created.body.id}`)
      .set('Authorization', `Bearer ${token(owner)}`);

    expect(withoutToken.status).toBe(401);
    expect(asOther.status).toBe(403);
    expect(asOwner.status).toBe(200);
  });
});
