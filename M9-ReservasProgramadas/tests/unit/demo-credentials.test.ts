import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createDemoToken, DEMO_CLIENT_ID } from '../../scripts/integration-demo.mjs';

describe('credenciales locales de integración', () => {
  it('firma HS256 para un único cliente y vence en 24 horas', () => {
    const secret = 'secreto-solo-de-esta-prueba';
    const token = createDemoToken(secret, 1000);
    const [header, payload, signature] = token.split('.');
    expect(JSON.parse(Buffer.from(header!, 'base64url').toString())).toEqual({
      alg: 'HS256',
      typ: 'JWT',
    });
    expect(JSON.parse(Buffer.from(payload!, 'base64url').toString())).toEqual({
      sub: DEMO_CLIENT_ID,
      role: 'CLIENTE',
      iat: 1000,
      exp: 87400,
    });
    expect(signature).toBe(
      createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url'),
    );
  });
});
