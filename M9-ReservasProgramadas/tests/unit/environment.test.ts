import { afterEach, describe, expect, it, vi } from 'vitest';
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});
describe('configuracion de integracion y recuperacion', () => {
  it('normaliza las credenciales opcionales vacias sin activar el modo demo', async () => {
    vi.stubEnv('M9_AUTH_MODE', 'm1');
    vi.stubEnv('M9_DEMO_AUTH_SECRET', '');
    vi.stubEnv('M9_DISPATCH_AUTH_URL', '');
    vi.stubEnv('M9_DISPATCH_AUTH_TOKEN', '');
    const { env } = await import('../../src/config/env.js');
    expect(env.M9_AUTH_MODE).toBe('m1');
    expect(env.M9_DEMO_AUTH_SECRET).toBeUndefined();
    expect(env.M9_DISPATCH_AUTH_URL).toBeUndefined();
    expect(env.M9_DISPATCH_AUTH_TOKEN).toBeUndefined();
  });
  it.each([
    ['M9_AUTH_MODE', 'disabled'],
    ['M1_TIMEOUT_MS', '-1'],
    ['ACTIVATION_RECOVERY_TIMEOUT_MS', '1'],
    ['M9_DEMO_AUTH_SECRET', 'short'],
  ])('rechaza configuracion insegura %s', async (name, value) => {
    vi.resetModules();
    vi.stubEnv(name, value);
    await expect(import('../../src/config/env.js')).rejects.toThrow(
      /Configuraci.n de entorno inv.lida/,
    );
  });
});
