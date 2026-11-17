import { createHmac } from 'node:crypto';
import { verifyJwt } from '../../src/middleware/auth.middleware';

const b64 = (value: object | string) =>
  Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url');

const sign = (payload: object, secret: string, header: object = { alg: 'HS256', typ: 'JWT' }) => {
  const head = b64(header);
  const body = b64(payload);
  const signature = createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${signature}`;
};

describe('RF-5.1 — verifyJwt (autenticación RNF-10)', () => {
  const secret = 'secreto-de-prueba';
  const now = 1_700_000_000;

  it('RF-5.1 acepta un token válido y devuelve el sub', () => {
    const token = sign({ sub: 'user_42', exp: now + 60 }, secret);
    expect(verifyJwt(token, secret, now)).toBe('user_42');
  });

  it('RF-5.1 acepta sub numérico y lo devuelve como string', () => {
    const token = sign({ sub: 42, exp: now + 60 }, secret);
    expect(verifyJwt(token, secret, now)).toBe('42');
  });

  it('RF-5.1 rechaza una firma hecha con otro secreto', () => {
    const token = sign({ sub: 'user_42', exp: now + 60 }, 'otro-secreto');
    expect(() => verifyJwt(token, secret, now)).toThrow('Firma inválida');
  });

  it('RF-5.1 rechaza un payload alterado con la firma original', () => {
    const original = sign({ sub: 'user_42', exp: now + 60 }, secret);
    const [head, , signature] = original.split('.');
    const forged = `${head}.${b64({ sub: 'admin', exp: now + 60 })}.${signature}`;
    expect(() => verifyJwt(forged, secret, now)).toThrow('Firma inválida');
  });

  it('RF-5.1 rechaza un token vencido', () => {
    const token = sign({ sub: 'user_42', exp: now - 1 }, secret);
    expect(() => verifyJwt(token, secret, now)).toThrow('Token vencido');
  });

  it('RF-5.1 rechaza un token sin vencimiento', () => {
    const token = sign({ sub: 'user_42' }, secret);
    expect(() => verifyJwt(token, secret, now)).toThrow('vencimiento');
  });

  it('RF-5.1 rechaza alg=none', () => {
    const token = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: 'user_42', exp: now + 60 })}.`;
    expect(() => verifyJwt(token, secret, now)).toThrow('Algoritmo no permitido');
  });

  it('RF-5.1 rechaza un token sin sub', () => {
    const token = sign({ exp: now + 60 }, secret);
    expect(() => verifyJwt(token, secret, now)).toThrow('no identifica al usuario');
  });

  it('RF-5.1 rechaza texto que no es un JWT', () => {
    expect(() => verifyJwt('esto-no-es-un-jwt', secret, now)).toThrow('Formato de token inválido');
  });
});
