import {
  CircuitState,
  ConsecutiveBreaker,
  ConstantBackoff,
  TimeoutStrategy,
  circuitBreaker,
  handleWhen,
  isBrokenCircuitError,
  isIsolatedCircuitError,
  isTaskCancelledError,
  retry,
  timeout,
  wrap,
  type CircuitBreakerPolicy,
  type RetryPolicy,
  type TimeoutPolicy
} from 'cockatiel';
import { ServiceUnavailableError, isServiceUnavailableError } from '../errors/service-unavailable.error.js';
import { logger } from '../observability/logging.js';
import { recordCircuitState } from '../observability/metrics.js';

export const DEPENDENCY_NAMES = ['postgres', 'redis', 'm1', 'soporte', 'm6'] as const;
export type DependencyName = (typeof DEPENDENCY_NAMES)[number];
export type CircuitStatus = 'closed' | 'open' | 'half_open' | 'isolated';
export type CircuitStates = Readonly<Record<DependencyName, CircuitStatus>>;

export type ExecuteOptions = {
  readonly idempotent: boolean;
};

export interface ResiliencePolicy {
  execute<T>(operation: (signal: AbortSignal) => Promise<T>, options: ExecuteOptions): Promise<T>;
}

type BuiltPolicy = {
  readonly circuit: CircuitBreakerPolicy;
  readonly retry: RetryPolicy;
  readonly deadline: TimeoutPolicy;
  readonly publicPolicy: ResiliencePolicy;
};

const DEFAULT_TIMEOUTS = {
  postgres: 3500,
  redis: 500,
  m1: 1500,
  soporte: 1500,
  m6: 1500
} as const satisfies Record<DependencyName, number>;

const CIRCUIT_STATUS = {
  [CircuitState.Closed]: 'closed',
  [CircuitState.Open]: 'open',
  [CircuitState.HalfOpen]: 'half_open',
  [CircuitState.Isolated]: 'isolated'
} as const satisfies Record<CircuitState, CircuitStatus>;

const policies = new Map<DependencyName, BuiltPolicy>();

function positiveIntFromEnv(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function nonNegativeIntFromEnv(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function policyTimeout(name: DependencyName): number {
  return positiveIntFromEnv(`${name.toUpperCase()}_POLICY_TIMEOUT_MS`, DEFAULT_TIMEOUTS[name]);
}

function statusFromError(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  if ('status' in error && typeof error.status === 'number') return error.status;
  if ('statusCode' in error && typeof error.statusCode === 'number') return error.statusCode;
  return undefined;
}

export function isTransientError(error: unknown): boolean {
  if (isServiceUnavailableError(error) || isTaskCancelledError(error)) return true;
  const status = statusFromError(error);
  return status === 429 || (status !== undefined && status >= 500 && status <= 599);
}

function circuitStatus(policy: CircuitBreakerPolicy): CircuitStatus {
  return CIRCUIT_STATUS[policy.state];
}

function unavailable(name: DependencyName, retryAfter?: number): ServiceUnavailableError {
  return new ServiceUnavailableError(`La dependencia ${name} no está disponible temporalmente`, retryAfter);
}

function buildPolicy(name: DependencyName): BuiltPolicy {
  const transientFailures = handleWhen(isTransientError);
  const retryPolicy = retry(transientFailures, {
    maxAttempts: nonNegativeIntFromEnv('RESILIENCE_RETRY_ATTEMPTS', 2),
    backoff: new ConstantBackoff(nonNegativeIntFromEnv('RESILIENCE_RETRY_DELAY_MS', 50))
  });
  const resetMs = positiveIntFromEnv('CIRCUIT_BREAKER_RESET_MS', 30_000);
  const circuit = circuitBreaker(transientFailures, {
    breaker: new ConsecutiveBreaker(positiveIntFromEnv('CIRCUIT_BREAKER_THRESHOLD', 3)),
    halfOpenAfter: resetMs
  });
  let openedAt: number | undefined;
  const timeoutMs = policyTimeout(name);
  const deadline = timeout(timeoutMs, TimeoutStrategy.Aggressive);

  recordCircuitState(name, circuitStatus(circuit));
  retryPolicy.onRetry(({ attempt, delay }) => {
    logger.warn({ dependency: name, attempt, delayMs: delay }, 'resilience.retry');
  });
  deadline.onTimeout(() => {
    logger.warn({ dependency: name, timeoutMs }, 'resilience.timeout');
  });
  circuit.onStateChange((state) => {
    const current = CIRCUIT_STATUS[state];
    openedAt = current === 'open' ? Date.now() : undefined;
    recordCircuitState(name, current);
    const fields = { dependency: name, circuitState: current };
    if (current === 'closed') {
      logger.info(fields, 'resilience.circuit.change');
      return;
    }
    logger.warn(fields, 'resilience.circuit.change');
  });

  const publicPolicy: ResiliencePolicy = {
    async execute<T>(operation: (signal: AbortSignal) => Promise<T>, options: ExecuteOptions): Promise<T> {
      const pipeline = options.idempotent
        ? wrap(retryPolicy, circuit, deadline)
        : circuit;
      try {
        return await pipeline.execute(({ signal }) => operation(signal));
      } catch (error) {
        if (
          isTransientError(error)
          || isBrokenCircuitError(error)
          || isIsolatedCircuitError(error)
          || isTaskCancelledError(error)
        ) {
          const retryAfter = openedAt === undefined
            ? undefined
            : Math.max(1, Math.ceil((resetMs - (Date.now() - openedAt)) / 1000));
          throw unavailable(name, retryAfter);
        }
        throw error;
      }
    }
  };

  return { circuit, retry: retryPolicy, deadline, publicPolicy };
}

function getBuiltPolicy(name: DependencyName): BuiltPolicy {
  const existing = policies.get(name);
  if (existing !== undefined) return existing;
  const created = buildPolicy(name);
  policies.set(name, created);
  return created;
}

export function createPolicy(name: DependencyName): ResiliencePolicy {
  return getBuiltPolicy(name).publicPolicy;
}

export function getCircuitStates(): CircuitStates {
  return {
    postgres: circuitStatus(getBuiltPolicy('postgres').circuit),
    redis: circuitStatus(getBuiltPolicy('redis').circuit),
    m1: circuitStatus(getBuiltPolicy('m1').circuit),
    soporte: circuitStatus(getBuiltPolicy('soporte').circuit),
    m6: circuitStatus(getBuiltPolicy('m6').circuit)
  };
}
