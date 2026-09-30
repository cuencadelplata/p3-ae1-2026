import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { CircuitBreaker, CircuitOpenError, type CircuitState } from '../../src/resilience/circuit-breaker';

const OPEN_MS = 10_000;

function setup(options: { isFailure?: (error: unknown) => boolean } = {}) {
  let now = 0;
  const transitions: string[] = [];
  const breaker = new CircuitBreaker({
    name: 'prueba',
    failureThreshold: 3,
    openDurationMs: OPEN_MS,
    now: () => now,
    onStateChange: (from: CircuitState, to: CircuitState) => transitions.push(`${from}->${to}`),
    ...options,
  });
  return {
    breaker,
    transitions,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

const ok = async () => 'ok';
const fail = async (): Promise<string> => {
  throw new Error('dependencia caida');
};

async function failTimes(breaker: CircuitBreaker, times: number): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await assert.rejects(breaker.execute(fail), /dependencia caida/);
  }
}

describe('Circuit breaker (Unit)', () => {
  it('debe permanecer cerrado mientras las fallas no lleguen al umbral', async () => {
    const { breaker } = setup();
    await failTimes(breaker, 2);
    assert.equal(breaker.state, 'closed');
    assert.equal(await breaker.execute(ok), 'ok');
  });

  it('un exito debe reiniciar la cuenta de fallas consecutivas', async () => {
    const { breaker } = setup();
    await failTimes(breaker, 2);
    await breaker.execute(ok);
    await failTimes(breaker, 2);
    assert.equal(breaker.state, 'closed');
  });

  it('debe abrirse al llegar al umbral y rechazar sin llamar a la dependencia', async () => {
    const { breaker, transitions } = setup();
    await failTimes(breaker, 3);
    assert.equal(breaker.state, 'open');
    assert.deepEqual(transitions, ['closed->open']);

    let called = false;
    const error = await breaker
      .execute(async () => {
        called = true;
        return 'ok';
      })
      .catch((rejection: unknown) => rejection);

    assert.ok(error instanceof CircuitOpenError);
    assert.equal(error.retryAfterMs, OPEN_MS);
    assert.equal(called, false, 'con el circuito abierto no se debe llamar a la dependencia');
  });

  it('debe informar el tiempo restante hasta la siguiente prueba', async () => {
    const { breaker, advance } = setup();
    await failTimes(breaker, 3);
    advance(4_000);
    assert.equal(breaker.retryAfterMs(), 6_000);
  });

  it('pasado el tiempo abierto debe admitir una prueba y cerrarse si sale bien', async () => {
    const { breaker, transitions, advance } = setup();
    await failTimes(breaker, 3);
    advance(OPEN_MS);

    assert.equal(breaker.state, 'half_open');
    assert.equal(await breaker.execute(ok), 'ok');
    assert.equal(breaker.state, 'closed');
    assert.deepEqual(transitions, ['closed->open', 'open->half_open', 'half_open->closed']);
  });

  it('si la prueba falla debe volver a abrirse por otro periodo completo', async () => {
    const { breaker, transitions, advance } = setup();
    await failTimes(breaker, 3);
    advance(OPEN_MS);

    await failTimes(breaker, 1);
    assert.equal(breaker.state, 'open');
    assert.equal(breaker.retryAfterMs(), OPEN_MS);
    assert.deepEqual(transitions, ['closed->open', 'open->half_open', 'half_open->open']);
  });

  it('en semiabierto debe dejar pasar una sola prueba a la vez', async () => {
    const { breaker, advance } = setup();
    await failTimes(breaker, 3);
    advance(OPEN_MS);

    let release: (value: string) => void = () => undefined;
    const trial = breaker.execute(() => new Promise<string>((resolve) => (release = resolve)));
    await assert.rejects(breaker.execute(ok), CircuitOpenError);

    release('ok');
    assert.equal(await trial, 'ok');
    assert.equal(breaker.state, 'closed');
  });

  it('un error que no es falla de la dependencia no debe abrir el circuito', async () => {
    class Rechazo extends Error {}
    const { breaker } = setup({ isFailure: (error) => !(error instanceof Rechazo) });

    for (let i = 0; i < 5; i += 1) {
      await assert.rejects(
        breaker.execute(async () => {
          throw new Rechazo('pedido rechazado');
        }),
        Rechazo,
      );
    }
    assert.equal(breaker.state, 'closed');
  });
});
