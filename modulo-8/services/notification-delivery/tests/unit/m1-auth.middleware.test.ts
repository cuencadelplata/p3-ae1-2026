import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  extractAuthenticatedUser,
  parseJwtPayload,
  verifyJwtSignature,
} from '../../src/http/auth/m1-auth.middleware.js';

function createSignedJwt(payload: Record<string, unknown>, secret: string): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}

test('Middleware de Autenticación M1 - Seguridad y Fail-Closed', async (t) => {
  const savedNodeEnv = process.env.NODE_ENV;
  const savedM1Secret = process.env.M1_JWT_SECRET;
  const savedJwtSecret = process.env.JWT_SECRET;

  t.afterEach(() => {
    if (savedNodeEnv !== undefined) {
      process.env.NODE_ENV = savedNodeEnv;
    } else {
      delete process.env.NODE_ENV;
    }
    if (savedM1Secret !== undefined) {
      process.env.M1_JWT_SECRET = savedM1Secret;
    } else {
      delete process.env.M1_JWT_SECRET;
    }
    if (savedJwtSecret !== undefined) {
      process.env.JWT_SECRET = savedJwtSecret;
    } else {
      delete process.env.JWT_SECRET;
    }
  });

  await t.test('Retorna null ante encabezados nulos o con formato inválido', () => {
    assert.equal(extractAuthenticatedUser(undefined), null);
    assert.equal(extractAuthenticatedUser(''), null);
    assert.equal(extractAuthenticatedUser('Basic dXNlcjpwYXNz'), null);
    assert.equal(extractAuthenticatedUser('Bearer '), null);
  });

  await t.test('Entorno TEST: permite resolver tokens de prueba test-token-<id>', () => {
    process.env.NODE_ENV = 'test';

    const user1 = extractAuthenticatedUser('Bearer test-token-91');
    assert.deepEqual(user1, { userId: 91, role: 'CLIENT' });

    const user2 = extractAuthenticatedUser('Bearer test-token-usr-1002');
    assert.deepEqual(user2, { userId: 1002, role: 'CLIENT' });

    const invalid = extractAuthenticatedUser('Bearer test-token-invalido');
    assert.equal(invalid, null);
  });

  await t.test('Entorno PRODUCCIÓN: tokens de prueba test-token-* están estrictamente prohibidos', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.M1_JWT_SECRET;
    delete process.env.JWT_SECRET;

    const result = extractAuthenticatedUser('Bearer test-token-91');
    assert.equal(result, null);
  });

  await t.test('Entorno PRODUCCIÓN: Falla cerrado si no hay M1_JWT_SECRET configurada', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.M1_JWT_SECRET;
    delete process.env.JWT_SECRET;

    const dummyToken = createSignedJwt({ userId: 55, role: 'CLIENT' }, 'cualquier_clave');
    const result = extractAuthenticatedUser(`Bearer ${dummyToken}`);
    assert.equal(result, null);
  });

  await t.test('Entorno PRODUCCIÓN: Rechaza tokens con firma inválida o clave errónea', () => {
    process.env.NODE_ENV = 'production';
    process.env.M1_JWT_SECRET = 'secreto_productivo_m1';

    const tokenConOtraClave = createSignedJwt({ userId: 55, role: 'CLIENT' }, 'clave_diferente');
    const result = extractAuthenticatedUser(`Bearer ${tokenConOtraClave}`);
    assert.equal(result, null);
  });

  await t.test('Entorno PRODUCCIÓN: Acepta token con firma HMAC-SHA256 válida y contrato canónico', () => {
    process.env.NODE_ENV = 'production';
    process.env.M1_JWT_SECRET = 'secreto_productivo_m1';

    const validToken = createSignedJwt({ userId: 55, role: 'CLIENT' }, 'secreto_productivo_m1');
    const result = extractAuthenticatedUser(`Bearer ${validToken}`);
    assert.deepEqual(result, { userId: 55, role: 'CLIENT' });
  });

  await t.test('Rechaza tokens donde userId no sea numérico positivo', () => {
    process.env.NODE_ENV = 'production';
    process.env.M1_JWT_SECRET = 'secreto_productivo_m1';

    const tokenStringId = createSignedJwt({ userId: 'usr-55', role: 'CLIENT' }, 'secreto_productivo_m1');
    assert.equal(extractAuthenticatedUser(`Bearer ${tokenStringId}`), null);

    const tokenNegativo = createSignedJwt({ userId: -10, role: 'CLIENT' }, 'secreto_productivo_m1');
    assert.equal(extractAuthenticatedUser(`Bearer ${tokenNegativo}`), null);

    const tokenCero = createSignedJwt({ userId: 0, role: 'CLIENT' }, 'secreto_productivo_m1');
    assert.equal(extractAuthenticatedUser(`Bearer ${tokenCero}`), null);
  });

  await t.test('parseJwtPayload decodifica payloads Base64Url válidos y maneja inválidos', () => {
    const payload = { userId: 123, role: 'ADMIN' };
    const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
    assert.deepEqual(parseJwtPayload(`header.${encoded}.signature`), payload);
    assert.equal(parseJwtPayload('invalido'), null);
  });

  await t.test('verifyJwtSignature retorna false para tokens mal formados', () => {
    assert.equal(verifyJwtSignature('no-jwt', 'secret'), false);
    assert.equal(verifyJwtSignature('part1.part2', 'secret'), false);
  });
});
