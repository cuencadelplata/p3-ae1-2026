export type CircuitState = 'closed' | 'open' | 'half_open';

export interface CircuitBreakerOptions {
  /** Nombre para los logs y los errores. */
  name: string;
  /** Fallas consecutivas que abren el circuito. */
  failureThreshold: number;
  /** Tiempo que el circuito permanece abierto antes de admitir una prueba. */
  openDurationMs: number;
  /**
   * Indica si un error cuenta como falla de la dependencia. Un rechazo de
   * negocio (por ejemplo, un 422) demuestra que la dependencia responde, por lo
   * que no debe abrir el circuito.
   */
  isFailure?: (error: unknown) => boolean;
  onStateChange?: (from: CircuitState, to: CircuitState) => void;
  /** Reloj inyectable para las pruebas. */
  now?: () => number;
}

/** El circuito esta abierto: la llamada se rechaza sin llegar a la dependencia. */
export class CircuitOpenError extends Error {
  constructor(
    readonly circuit: string,
    readonly retryAfterMs: number,
  ) {
    super(`Circuito ${circuit} abierto: se reintenta en ${Math.ceil(retryAfterMs / 1000)} s`);
    this.name = 'CircuitOpenError';
  }
}

/**
 * Circuit breaker para una dependencia sincronica.
 *
 * - Cerrado: las llamadas pasan. Cada falla suma; un exito reinicia la cuenta.
 *   Al llegar a failureThreshold fallas seguidas, se abre.
 * - Abierto: las llamadas fallan al instante con CircuitOpenError, sin esperar
 *   el timeout de una dependencia que se sabe caida. Pasado openDurationMs,
 *   pasa a semiabierto.
 * - Semiabierto: deja pasar una unica llamada de prueba. Si sale bien, se
 *   cierra; si falla, vuelve a abrirse por otro openDurationMs. Mientras la
 *   prueba esta en curso, el resto se rechaza.
 *
 * El estado vive en memoria de cada instancia: con dos replicas, cada una
 * detecta la caida por su cuenta, que es lo esperable para un breaker del lado
 * del cliente.
 */
export class CircuitBreaker {
  private current: CircuitState = 'closed';
  private failures = 0;
  private openedAt = 0;
  private trialInFlight = false;

  private readonly now: () => number;
  private readonly isFailure: (error: unknown) => boolean;

  constructor(private readonly options: CircuitBreakerOptions) {
    this.now = options.now ?? Date.now;
    this.isFailure = options.isFailure ?? (() => true);
  }

  get state(): CircuitState {
    if (this.current === 'open' && this.now() - this.openedAt >= this.options.openDurationMs) {
      this.transition('half_open');
    }
    return this.current;
  }

  /** Milisegundos hasta que el circuito admita una llamada de prueba. */
  retryAfterMs(): number {
    if (this.state !== 'open') {
      return 0;
    }
    return Math.max(0, this.options.openDurationMs - (this.now() - this.openedAt));
  }

  async execute<T>(operation: () => Promise<T>): Promise<T> {
    const state = this.state;

    if (state === 'open' || (state === 'half_open' && this.trialInFlight)) {
      throw new CircuitOpenError(this.options.name, this.retryAfterMs() || this.options.openDurationMs);
    }

    const isTrial = state === 'half_open';
    if (isTrial) {
      this.trialInFlight = true;
    }

    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error) {
      if (this.isFailure(error)) {
        this.onFailure();
      } else {
        this.onSuccess();
      }
      throw error;
    } finally {
      if (isTrial) {
        this.trialInFlight = false;
      }
    }
  }

  private onSuccess(): void {
    this.failures = 0;
    if (this.current !== 'closed') {
      this.transition('closed');
    }
  }

  private onFailure(): void {
    this.failures += 1;
    if (this.current === 'half_open' || this.failures >= this.options.failureThreshold) {
      this.openedAt = this.now();
      if (this.current !== 'open') {
        this.transition('open');
      }
    }
  }

  private transition(to: CircuitState): void {
    const from = this.current;
    this.current = to;
    this.options.onStateChange?.(from, to);
  }
}
