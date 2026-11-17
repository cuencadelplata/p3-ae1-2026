import { env } from '../config/env';
import { DependencyUnavailableError } from '../errors/dependency-unavailable.error';
import type { FiscalAuthorization } from '../models/receipt';
import { createLogger, errorMessage } from '../observability/logger';
import { CircuitBreaker, CircuitOpenError, type CircuitState } from '../resilience/circuit-breaker';

/**
 * Datos que se envian al autorizador. Solo identificadores e importes: ningun
 * dato personal del cliente ni del conductor sale del servicio.
 */
export interface FiscalAuthorizationRequest {
  tripId: string;
  issuedAt: string;
  currency: string;
  total: number;
}

/** El autorizador respondio y rechazo el pedido: reintentarlo no cambia el resultado. */
export class FiscalAuthorizationRejectedError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'FiscalAuthorizationRejectedError';
  }
}

/**
 * El autorizador no respondio como corresponde: sin conexion, sin respuesta a
 * tiempo, error 5xx o respuesta con formato inesperado. Es la unica clase de
 * error que cuenta como falla para el circuito.
 */
class FiscalServiceFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FiscalServiceFailure';
  }
}

export interface FiscalClientOptions {
  baseUrl: string;
  timeoutMs: number;
  failureThreshold: number;
  openDurationMs: number;
  now?: () => number;
}

export interface FiscalClient {
  authorize(request: FiscalAuthorizationRequest): Promise<FiscalAuthorization>;
  circuitState(): CircuitState;
  /** Verificacion de salud: consulta al autorizador sin pasar por el circuito. */
  isReachable(): Promise<boolean>;
}

const AUTHORIZATION_CODE = /^\d{14}$/;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function failureReason(error: unknown, timeoutMs: number): string {
  if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
    return `sin respuesta en ${timeoutMs} ms`;
  }
  // fetch informa los errores de red como "fetch failed" con el codigo en la
  // causa, o en la primera de varias causas si probo mas de una direccion.
  const cause = (error as { cause?: { code?: unknown; errors?: Array<{ code?: unknown }> } } | null)?.cause;
  const code = cause?.code ?? cause?.errors?.[0]?.code;
  return typeof code === 'string' ? code : errorMessage(error);
}

async function readBody(response: Response): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await response.json();
    return typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function toAuthorization(body: Record<string, unknown> | null): FiscalAuthorization | null {
  const code = body?.['authorizationCode'];
  const expiresOn = body?.['expiresOn'];
  const authorizedAt = body?.['authorizedAt'];
  if (
    typeof code !== 'string' ||
    !AUTHORIZATION_CODE.test(code) ||
    typeof expiresOn !== 'string' ||
    !DATE_ONLY.test(expiresOn) ||
    typeof authorizedAt !== 'string' ||
    Number.isNaN(Date.parse(authorizedAt))
  ) {
    return null;
  }
  return { authorizationCode: code, expiresOn, authorizedAt };
}

/**
 * Cliente del autorizador fiscal: timeout por llamada y circuit breaker.
 *
 * La clave de idempotencia es el tripId. Si el servicio reintenta despues de
 * un timeout (el autorizador pudo haber autorizado igual) o dos replicas emiten
 * el mismo viaje a la vez, el autorizador devuelve la misma autorizacion en
 * lugar de otorgar una segunda.
 */
export function createFiscalClient(options: FiscalClientOptions): FiscalClient {
  const log = createLogger('fiscal');

  const breaker = new CircuitBreaker({
    name: 'fiscal',
    failureThreshold: options.failureThreshold,
    openDurationMs: options.openDurationMs,
    isFailure: (error) => error instanceof FiscalServiceFailure,
    onStateChange: (from, to) =>
      log(to === 'closed' ? 'info' : 'warn', `circuito del autorizador fiscal: ${to}`, { from, to }),
    ...(options.now ? { now: options.now } : {}),
  });

  async function call(request: FiscalAuthorizationRequest): Promise<FiscalAuthorization> {
    let response: Response;
    let body: Record<string, unknown> | null;
    try {
      response = await fetch(`${options.baseUrl}/v1/authorizations`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': request.tripId },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(options.timeoutMs),
      });
      body = await readBody(response);
    } catch (error) {
      throw new FiscalServiceFailure(failureReason(error, options.timeoutMs));
    }

    if (response.status >= 500 || response.status === 429) {
      throw new FiscalServiceFailure(`respondio ${response.status}`);
    }

    if (!response.ok) {
      const error = body?.['error'] as { code?: unknown; message?: unknown } | undefined;
      throw new FiscalAuthorizationRejectedError(
        typeof error?.code === 'string' ? error.code : `HTTP_${response.status}`,
        typeof error?.message === 'string' ? error.message : `El autorizador rechazo el pedido (${response.status})`,
      );
    }

    const authorization = toAuthorization(body);
    if (!authorization) {
      throw new FiscalServiceFailure('respuesta con formato inesperado');
    }
    return authorization;
  }

  return {
    async authorize(request) {
      try {
        return await breaker.execute(() => call(request));
      } catch (error) {
        if (error instanceof CircuitOpenError) {
          throw new DependencyUnavailableError(
            'fiscal',
            'El autorizador fiscal no esta disponible (circuito abierto)',
            Math.ceil(error.retryAfterMs / 1000),
            { cause: error },
          );
        }
        if (error instanceof FiscalServiceFailure) {
          log('warn', 'fallo la llamada al autorizador fiscal', { reason: error.message, circuit: breaker.state });
          throw new DependencyUnavailableError(
            'fiscal',
            `El autorizador fiscal no esta disponible: ${error.message}`,
            Math.max(1, Math.ceil(breaker.retryAfterMs() / 1000)),
            { cause: error },
          );
        }
        throw error;
      }
    },

    circuitState: () => breaker.state,

    async isReachable() {
      try {
        const response = await fetch(`${options.baseUrl}/health`, { signal: AbortSignal.timeout(options.timeoutMs) });
        return response.ok;
      } catch {
        return false;
      }
    },
  };
}

export const fiscalClient = createFiscalClient({
  baseUrl: env.fiscalApiUrl,
  timeoutMs: env.fiscalTimeoutMs,
  failureThreshold: env.fiscalCircuitFailureThreshold,
  openDurationMs: env.fiscalCircuitOpenMs,
});
