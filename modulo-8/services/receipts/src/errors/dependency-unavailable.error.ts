export type Dependency = 'postgres' | 'fiscal';

const CODES: Record<Dependency, string> = {
  postgres: 'DATABASE_UNAVAILABLE',
  fiscal: 'FISCAL_SERVICE_UNAVAILABLE',
};

/**
 * Una dependencia necesaria para completar la operacion no esta disponible
 * (caida, sin respuesta a tiempo o con el circuito abierto).
 *
 * La falla no es del pedido ni del mensaje: el mismo pedido va a funcionar
 * cuando la dependencia se recupere. Por eso la API responde 503 con
 * Retry-After y el consumidor reintenta el mensaje sin descontarle intentos.
 */
export class DependencyUnavailableError extends Error {
  readonly code: string;

  constructor(
    readonly dependency: Dependency,
    message: string,
    readonly retryAfterSeconds = 5,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'DependencyUnavailableError';
    this.code = CODES[dependency];
  }
}
