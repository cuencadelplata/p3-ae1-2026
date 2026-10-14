import { describe, expect, it } from 'vitest';
import { checkSupportReadiness } from './readiness.js';

function diferido() {
  let resolver!: (valor: boolean) => void;
  const promesa = new Promise<boolean>((resolve) => {
    resolver = resolve;
  });
  return { promesa, resolver };
}

describe('checkSupportReadiness: M6 y M1 en paralelo', () => {
  it('consulta M1 sin esperar a que M6 responda', async () => {
    const m6 = diferido();
    let m1Consultado = false;

    const readiness = checkSupportReadiness({
      trips: () => m6.promesa,
      identity: async () => {
        m1Consultado = true;
        return true;
      },
    });
    await Promise.resolve();

    expect(m1Consultado).toBe(true);
    m6.resolver(false);
    expect((await readiness).checks).toEqual({
      trips: { status: 'unavailable', critical: false },
      identity: { status: 'available', critical: false },
    });
  });

  it('con M6 y M1 lentos, la espera es la del más lento y no la suma', async () => {
    const lento = (ms: number) => () => new Promise<boolean>((resolve) => setTimeout(() => resolve(true), ms));

    const inicio = Date.now();
    const readiness = await checkSupportReadiness({ trips: lento(150), identity: lento(150) });
    const duracion = Date.now() - inicio;

    expect(readiness.status).toBe('ok');
    expect(duracion).toBeLessThan(290);
  });
});
