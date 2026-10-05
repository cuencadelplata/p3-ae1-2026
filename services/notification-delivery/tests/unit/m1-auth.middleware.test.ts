import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  CANONICAL_M1_ROLES,
  extractAuthenticatedUser,
  parseJwtPayload,
  verifyJwtSignature,
} from '../../src/http/auth/m1-auth.middleware.js';

function createSignedJwt(
  payload: Record<string, unknown>,
  secret: string,
  headerValues: Record<string, unknown> = { alg: 'HS256', typ: 'JWT' }
): string {
  const header = Buffer.from(JSON.stringify(headerValues)).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}

test('Middleware de Autenticación M1 - Seguridad, Expiración y Roles Canónicos', async (t) => {
  const savedNodeEnv = process.env.NODE_ENV;
  const savedM1Secret = process.env.M1_JWT_SECRET;
  const savedJwtSecret = process.env.JWT_SECRET;
  const savedRequireExp = process.env.M1_JWT_REQUIRE_EXP;

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
    if (savedRequireExp !== undefined) {
      process.env.M1_JWT_REQUIRE_EXP = savedRequireExp;
    } else {
      delete process.env.M1_JWT_REQUIRE_EXP;
    }
  });

  await t.test('Retorna null ante encabezados nulos o con formato inválido', () => {
    assert.equal(extractAuthenticatedUser(undefined), null);
    assert.equal(extractAuthenticatedUser(''), null);
    assert.equal(extractAuthenticatedUser('Basic dXNlcjpwYXNz'), null);
    assert.equal(extractAuthenticatedUser('Bearer '), null);
  });

  await t.test('Entorno TEST: permite resolver tokens de prueba sin inventar roles arbitrarios', () => {
    process.env.NODE_ENV = 'test';

    // Token sin rol explícito: no inventa fallback
    const user1 = extractAuthenticatedUser('Bearer test-token-91');
    assert.deepEqual(user1, { userId: 91 });

    // Token con rol canónico explícito CLIENTE
    const user2 = extractAuthenticatedUser('Bearer test-token-cliente-1002');
    assert.deepEqual(user2, { userId: 1002, role: 'CLIENTE' });

    // Token con rol canónico CONDUCTOR
    const user3 = extractAuthenticatedUser('Bearer test-token-conductor-2005');
    assert.deepEqual(user3, { userId: 2005, role: 'CONDUCTOR' });

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

    const dummyToken = createSignedJwt({ userId: 55, role: 'CLIENTE' }, 'cualquier_clave');
    const result = extractAuthenticatedUser(`Bearer ${dummyToken}`);
    assert.equal(result, null);
  });

  await t.test('Entorno PRODUCCIÓN: Rechaza tokens con firma inválida o clave errónea', () => {
    process.env.NODE_ENV = 'production';
    process.env.M1_JWT_SECRET = 'secreto_productivo_m1';

    const tokenConOtraClave = createSignedJwt({ userId: 55, role: 'CLIENTE' }, 'clave_diferente');
    const result = extractAuthenticatedUser(`Bearer ${tokenConOtraClave}`);
    assert.equal(result, null);
  });

  await t.test('Entorno PRODUCCIÓN: Rechaza algoritmos JWT distintos de HS256 aunque la firma sea válida', () => {
    process.env.NODE_ENV = 'production';
    process.env.M1_JWT_SECRET = 'secreto_productivo_m1';

    const tokenConAlgoritmoInvalido = createSignedJwt(
      { userId: 55, role: 'CLIENTE' },
      'secreto_productivo_m1',
      { alg: 'none', typ: 'JWT' }
    );

    assert.equal(extractAuthenticatedUser(`Bearer ${tokenConAlgoritmoInvalido}`), null);
  });

  await t.test('Entorno PRODUCCIÓN: Acepta token firmado válido con rol canónico', () => {
    process.env.NODE_ENV = 'production';
    process.env.M1_JWT_SECRET = 'secreto_productivo_m1';

    for (const role of CANONICAL_M1_ROLES) {
      const validToken = createSignedJwt({ userId: 55, role }, 'secreto_productivo_m1');
      const result = extractAuthenticatedUser(`Bearer ${validToken}`);
      assert.deepEqual(result, { userId: 55, role });
    }
  });

  await t.test('Entorno PRODUCCIÓN: Conserva token sin rol sin inventar fallback arbitrario', () => {
    process.env.NODE_ENV = 'production';
    process.env.M1_JWT_SECRET = 'secreto_productivo_m1';

    // No debe inventar 'CLIENT' ni 'CLIENTE' cuando role no viene en el token
    const tokenSinRol = createSignedJwt({ userId: 77 }, 'secreto_productivo_m1');
    const result = extractAuthenticatedUser(`Bearer ${tokenSinRol}`);
    assert.deepEqual(result, { userId: 77 });
    assert.equal(result?.role, undefined);
  });

  await t.test('Rechaza token si contiene un rol no canónico o inválido', () => {
    process.env.NODE_ENV = 'production';
    process.env.M1_JWT_SECRET = 'secreto_productivo_m1';

    // 'CLIENT' en inglés es inválido: los canónicos de M1 son CLIENTE, CONDUCTOR, OPERADOR
    const tokenRolIngles = createSignedJwt({ userId: 55, role: 'CLIENT' }, 'secreto_productivo_m1');
    assert.equal(extractAuthenticatedUser(`Bearer ${tokenRolIngles}`), null);

    const tokenRolAdmin = createSignedJwt({ userId: 55, role: 'ADMIN' }, 'secreto_productivo_m1');
    assert.equal(extractAuthenticatedUser(`Bearer ${tokenRolAdmin}`), null);

    const tokenRolNumero = createSignedJwt({ userId: 55, role: 123 }, 'secreto_productivo_m1');
    assert.equal(extractAuthenticatedUser(`Bearer ${tokenRolNumero}`), null);
  });

  await t.test('VALIDACIÓN DE EXP: Rechaza token firmado pero expirado', () => {
    process.env.NODE_ENV = 'production';
    process.env.M1_JWT_SECRET = 'secreto_productivo_m1';

    const nowSeconds = Math.floor(Date.now() / 1000);
    // Expirado hace 60 segundos
    const expiredToken = createSignedJwt(
      { userId: 55, role: 'CLIENTE', exp: nowSeconds - 60 },
      'secreto_productivo_m1'
    );
    assert.equal(extractAuthenticatedUser(`Bearer ${expiredToken}`), null);
  });

  await t.test('VALIDACIÓN DE EXP: Acepta token firmado vigente', () => {
    process.env.NODE_ENV = 'production';
    process.env.M1_JWT_SECRET = 'secreto_productivo_m1';

    const nowSeconds = Math.floor(Date.now() / 1000);
    // Vigente por 3600 segundos (1 hora)
    const validExpToken = createSignedJwt(
      { userId: 55, role: 'CLIENTE', exp: nowSeconds + 3600 },
      'secreto_productivo_m1'
    );
    const result = extractAuthenticatedUser(`Bearer ${validExpToken}`);
    assert.deepEqual(result, { userId: 55, role: 'CLIENTE' });
  });

  await t.test('VALIDACIÓN DE EXP: Rechaza token con exp malformado o no numérico', () => {
    process.env.NODE_ENV = 'production';
    process.env.M1_JWT_SECRET = 'secreto_productivo_m1';

    const tokenExpString = createSignedJwt(
      { userId: 55, role: 'CLIENTE', exp: '2026-10-05T00:00:00Z' },
      'secreto_productivo_m1'
    );
    assert.equal(extractAuthenticatedUser(`Bearer ${tokenExpString}`), null);
  });

  await t.test('M1_JWT_REQUIRE_EXP: Rechaza token sin exp cuando la política lo exige obligatorio', () => {
    process.env.NODE_ENV = 'production';
    process.env.M1_JWT_SECRET = 'secreto_productivo_m1';
    process.env.M1_JWT_REQUIRE_EXP = 'true';

    const tokenSinExp = createSignedJwt({ userId: 55, role: 'CLIENTE' }, 'secreto_productivo_m1');
    assert.equal(extractAuthenticatedUser(`Bearer ${tokenSinExp}`), null);
  });

  await t.test('Rechaza tokens donde userId no sea numérico positivo', () => {
    process.env.NODE_ENV = 'production';
    process.env.M1_JWT_SECRET = 'secreto_productivo_m1';

    const tokenStringId = createSignedJwt({ userId: 'usr-55', role: 'CLIENTE' }, 'secreto_productivo_m1');
    assert.equal(extractAuthenticatedUser(`Bearer ${tokenStringId}`), null);

    const tokenNegativo = createSignedJwt({ userId: -10, role: 'CLIENTE' }, 'secreto_productivo_m1');
    assert.equal(extractAuthenticatedUser(`Bearer ${tokenNegativo}`), null);

    const tokenCero = createSignedJwt({ userId: 0, role: 'CLIENTE' }, 'secreto_productivo_m1');
    assert.equal(extractAuthenticatedUser(`Bearer ${tokenCero}`), null);
  });

  await t.test('parseJwtPayload decodifica payloads Base64Url válidos y maneja inválidos', () => {
    const payload = { userId: 123, role: 'CLIENTE' };
    const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
    assert.deepEqual(parseJwtPayload(`header.${encoded}.signature`), payload);
    assert.equal(parseJwtPayload('invalido'), null);
  });

  await t.test('verifyJwtSignature retorna false para tokens mal formados', () => {
    assert.equal(verifyJwtSignature('no-jwt', 'secret'), false);
    assert.equal(verifyJwtSignature('part1.part2', 'secret'), false);
  });
});
