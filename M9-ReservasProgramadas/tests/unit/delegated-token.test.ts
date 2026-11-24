import jwt from 'jsonwebtoken';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DelegatedDispatchTokenProvider } from '../../src/clients/delegated-dispatch-token.provider.js';
import { runWithRequestContext } from '../../src/integration/request-context.js';
afterEach(() => vi.restoreAllMocks());
const access = (clientId: string, expiresIn = 300) =>
  jwt.sign({ userId: Number(clientId), role: 'CLIENTE' }, 'fixture-only-delegated-token-secret', {
    subject: clientId,
    expiresIn,
  });
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
describe('credenciales de despacho por cliente', () => {
  it('no guarda ni reutiliza el token de una solicitud para el scheduler', async () => {
    const current = access('101');
    const provider = new DelegatedDispatchTokenProvider(undefined, undefined, 'http://m1.test');
    expect(
      await runWithRequestContext(
        { correlationId: 'request', authorization: 'Bearer ' + current },
        () => provider.getAuthorization('101'),
      ),
    ).toBe('Bearer ' + current);
    await expect(provider.getAuthorization('101')).rejects.toMatchObject({
      code: 'DELEGACION_NO_CONFIGURADA',
    });
  });
  it('pide una credencial nueva por cliente y valida la identidad con M1', async () => {
    const first = access('101');
    const second = access('202');
    const mock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(json({ access_token: first }))
      .mockResolvedValueOnce(json({ valid: true, userId: 101, role: 'CLIENTE' }))
      .mockResolvedValueOnce(json({ access_token: second }))
      .mockResolvedValueOnce(json({ valid: true, userId: 202, role: 'CLIENTE' }));
    const provider = new DelegatedDispatchTokenProvider(
      'http://issuer.test/token',
      'fixture-service-credential',
      'http://m1.test',
    );
    expect(await provider.getAuthorization('101')).toBe('Bearer ' + first);
    expect(await provider.getAuthorization('202')).toBe('Bearer ' + second);
    expect(JSON.parse(String(mock.mock.calls[0]![1]!.body)).clientId).toBe('101');
    expect(JSON.parse(String(mock.mock.calls[2]![1]!.body)).clientId).toBe('202');
  });
  it.each([
    { valid: true, userId: 202, role: 'CLIENTE' },
    { valid: false, userId: 101, role: 'CLIENTE' },
    { valid: true, userId: 101, role: 'CONDUCTOR' },
  ])('rechaza identidad ajena, revocada o de otro rol', async (identity) => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(json({ access_token: 'wrong' }))
      .mockResolvedValueOnce(json(identity));
    await expect(
      new DelegatedDispatchTokenProvider(
        'http://issuer.test/token',
        'fixture-service-credential',
        'http://m1.test',
      ).getAuthorization('101'),
    ).rejects.toMatchObject({ code: 'DELEGACION_NO_DISPONIBLE' });
  });
  it('falla cerrado si el emisor esta caido o responde un contrato invalido', async () => {
    const mock = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(json({ token: 'wrong-contract' }));
    const provider = new DelegatedDispatchTokenProvider(
      'http://issuer.test/token',
      'fixture-service-credential',
      'http://m1.test',
    );
    for (let i = 0; i < 2; i++)
      await expect(provider.getAuthorization('101')).rejects.toMatchObject({
        code: 'DELEGACION_NO_DISPONIBLE',
      });
    expect(mock).toHaveBeenCalledTimes(2);
  });
});

it.each([access('202'), access('101', -1), 'not-a-jwt'])(
  'no envia a M5 un token con subject ajeno, vencido o ilegible',
  async (token) => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(json({ access_token: token }))
      .mockResolvedValueOnce(json({ valid: true, userId: 101, role: 'CLIENTE' }));
    await expect(
      new DelegatedDispatchTokenProvider(
        'http://issuer.test/token',
        'fixture-service-credential',
        'http://m1.test',
      ).getAuthorization('101'),
    ).rejects.toMatchObject({ code: 'DELEGACION_NO_DISPONIBLE' });
  },
);
