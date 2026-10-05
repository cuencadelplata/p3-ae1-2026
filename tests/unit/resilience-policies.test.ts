import { afterEach, describe, expect, it, vi } from 'vitest';
import { ServiceUnavailableError } from '../../src/errors/service-unavailable.error.js';
import { createPolicy, getCircuitStates } from '../../src/resilience/policies.js';

function networkError(): Error {
  return Object.assign(new Error('connection reset'), { code: 'ECONNRESET' });
}

describe('Políticas compartidas de resiliencia', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('reintenta errores transitorios únicamente cuando la operación es idempotente', async () => {
    // Given
    vi.stubEnv('RESILIENCE_RETRY_ATTEMPTS', '2');
    vi.stubEnv('RESILIENCE_RETRY_DELAY_MS', '0');
    let attempts = 0;
    const operation = async (): Promise<string> => {
      attempts += 1;
      if (attempts < 3) throw networkError();
      return 'ok';
    };

    // When
    const result = await createPolicy('m1').execute(operation, { idempotent: true });

    // Then
    expect(result).toBe('ok');
    expect(attempts).toBe(3);
  });

  it('no reintenta una operación no idempotente', async () => {
    // Given
    let attempts = 0;
    const operation = async (): Promise<never> => {
      attempts += 1;
      throw networkError();
    };

    // When
    const result = createPolicy('postgres').execute(operation, { idempotent: false });

    // Then
    await expect(result).rejects.toBeInstanceOf(ServiceUnavailableError);
    expect(attempts).toBe(1);
  });

  it('deja pasar errores no transitorios sin reintento ni traducción', async () => {
    // Given
    const domainError = new RangeError('invalid customer state');
    let attempts = 0;
    const operation = async (): Promise<never> => {
      attempts += 1;
      throw domainError;
    };

    // When
    const result = createPolicy('redis').execute(operation, { idempotent: true });

    // Then
    await expect(result).rejects.toBe(domainError);
    expect(attempts).toBe(1);
  });

  it('corta una dependencia lenta con un timeout acotado', async () => {
    // Given
    vi.stubEnv('M6_POLICY_TIMEOUT_MS', '20');
    vi.stubEnv('RESILIENCE_RETRY_ATTEMPTS', '0');
    const policy = createPolicy('m6');
    const operation = async (signal: AbortSignal): Promise<never> => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(networkError()), { once: true });
    });
    const startedAt = performance.now();

    // When
    const result = policy.execute(operation, { idempotent: true });

    // Then
    await expect(result).rejects.toBeInstanceOf(ServiceUnavailableError);
    expect(performance.now() - startedAt).toBeLessThan(250);
  });

  it('no corta anticipadamente una escritura no idempotente que podría confirmar tarde', async () => {
    // Given
    const policy = createPolicy('m6');
    const operation = async (): Promise<string> => new Promise((resolve) => {
      setTimeout(() => resolve('committed'), 40);
    });

    // When
    const result = await policy.execute(operation, { idempotent: false });

    // Then
    expect(result).toBe('committed');
  });

  it('abre el circuito después de fallas transitorias consecutivas', async () => {
    // Given
    vi.stubEnv('CIRCUIT_BREAKER_THRESHOLD', '2');
    let calls = 0;
    const policy = createPolicy('soporte');
    const operation = async (): Promise<never> => {
      calls += 1;
      throw Object.assign(new Error('upstream unavailable'), { status: 503 });
    };

    // When
    await expect(policy.execute(operation, { idempotent: false })).rejects.toBeInstanceOf(ServiceUnavailableError);
    await expect(policy.execute(operation, { idempotent: false })).rejects.toBeInstanceOf(ServiceUnavailableError);
    await expect(policy.execute(operation, { idempotent: false })).rejects.toBeInstanceOf(ServiceUnavailableError);

    // Then
    expect(calls).toBe(2);
    expect(getCircuitStates().soporte).toBe('open');
  });

  it('expone el estado de todos los circuitos compartidos', () => {
    // Given / When
    const states = getCircuitStates();

    // Then
    expect(Object.keys(states).sort()).toEqual(['m1', 'm6', 'postgres', 'redis', 'soporte']);
  });
});
