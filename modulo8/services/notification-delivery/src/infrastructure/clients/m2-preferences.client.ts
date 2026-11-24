import type { UserPreferences } from '../../domain/delivery.types.js';

export interface M2PreferencesClient {
  getPreferences(userId: number, correlationId: string): Promise<UserPreferences>;
}

export class M2PreferencesError extends Error {
  constructor(
    public readonly code: 'CUSTOMER_NOT_FOUND' | 'CONFIGURATION' | 'UNAVAILABLE',
    message: string,
  ) {
    super(`[M2_CLIENT_ERROR] ${message}`);
    this.name = 'M2PreferencesError';
  }
}

export class HttpM2PreferencesClient implements M2PreferencesClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly timeoutMs: number = 3000
  ) {}

  async getPreferences(userId: number, correlationId: string): Promise<UserPreferences> {
    const url = `${this.baseUrl}/internal/preferences/${userId}`;
    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), this.timeoutMs);
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'x-api-key': this.apiKey,
          'x-correlation-id': correlationId,
          'Accept': 'application/json',
        },
        signal: abortController.signal,
      });

      if (!response.ok) {
        if (response.status === 404) {
          const body: unknown = await response.json().catch(() => null);
          const errorCode = body && typeof body === 'object' && 'error' in body ? body.error : undefined;
          if (errorCode === 'CustomerNotFound') {
            throw new M2PreferencesError('CUSTOMER_NOT_FOUND', `El usuario ${userId} no tiene perfil de cliente en M2.`);
          }
          throw new M2PreferencesError('CONFIGURATION', `M2 devolvió 404 ${String(errorCode ?? 'sin código')} para ${url}.`);
        }
        throw new M2PreferencesError(
          response.status === 503 ? 'UNAVAILABLE' : 'CONFIGURATION',
          `M2 retornó error HTTP ${response.status}: ${response.statusText}`,
        );
      }

      const body = (await response.json()) as {
        data?: { notificationsEnabled?: boolean; pushEnabled?: boolean };
        notificationsEnabled?: boolean;
        pushEnabled?: boolean;
      };

      const data = body.data ?? body;
      if (
        typeof data.notificationsEnabled !== 'boolean' ||
        typeof data.pushEnabled !== 'boolean'
      ) {
        throw new M2PreferencesError('CONFIGURATION', 'M2 respondió preferencias con un formato inválido.');
      }

      if ('userId' in data && data.userId !== userId) {
        throw new M2PreferencesError('CONFIGURATION', 'M2 respondió preferencias de otro usuario.');
      }

      return {
        userId,
        notificationsEnabled: data.notificationsEnabled,
        pushEnabled: data.pushEnabled,
      };
    } catch (err: unknown) {
      if (err instanceof M2PreferencesError) throw err;
      const message = err instanceof Error ? err.message : 'Error desconocido al contactar M2';
      throw new M2PreferencesError('UNAVAILABLE', `Falla al consultar preferencias de ${userId}: ${message}`);
    } finally {
      clearTimeout(timeout);
    }
  }
}

export interface M2CircuitBreakerOptions {
  /** Fallas UNAVAILABLE seguidas que abren el circuito. */
  failureThreshold?: number;
  /** Tiempo con el circuito abierto antes de probar de nuevo, en milisegundos. */
  openMs?: number;
  now?: () => number;
}

/**
 * Circuit breaker delante del cliente de M2.
 *
 * Si M2 no está levantado, cada consulta tarda segundos en fallar (DNS de un
 * nombre que no existe más el timeout). En un proceso Node esas búsquedas
 * ocupan los hilos de libuv y frenan al resto de la app única: la validación
 * de tokens con M1 y las conexiones a PostgreSQL de otros RF. Con el circuito
 * abierto la consulta falla al instante como UNAVAILABLE (reintentable) sin
 * tocar la red. Solo cuentan las fallas UNAVAILABLE: si M2 responde, aunque sea
 * con un error de negocio, la dependencia está viva.
 */
export class CircuitBreakerM2PreferencesClient implements M2PreferencesClient {
  private failures = 0;
  private openedAt: number | undefined;
  private trialInFlight = false;
  private readonly failureThreshold: number;
  private readonly openMs: number;
  private readonly now: () => number;

  constructor(private readonly inner: M2PreferencesClient, options: M2CircuitBreakerOptions = {}) {
    this.failureThreshold = options.failureThreshold ?? 3;
    this.openMs = options.openMs ?? 30_000;
    this.now = options.now ?? Date.now;
  }

  state(): 'closed' | 'open' | 'half-open' {
    if (this.openedAt === undefined) return 'closed';
    return this.now() - this.openedAt >= this.openMs ? 'half-open' : 'open';
  }

  async getPreferences(userId: number, correlationId: string): Promise<UserPreferences> {
    const state = this.state();
    if (state === 'open' || (state === 'half-open' && this.trialInFlight)) {
      throw new M2PreferencesError('UNAVAILABLE', `Circuito de M2 abierto: no se consultan preferencias de ${userId}.`);
    }
    const trial = state === 'half-open';
    if (trial) this.trialInFlight = true;
    try {
      const preferences = await this.inner.getPreferences(userId, correlationId);
      this.failures = 0;
      this.openedAt = undefined;
      return preferences;
    } catch (error) {
      if (error instanceof M2PreferencesError && error.code === 'UNAVAILABLE') {
        this.failures += 1;
        if (trial || this.failures >= this.failureThreshold) this.openedAt = this.now();
      } else {
        this.failures = 0;
        this.openedAt = undefined;
      }
      throw error;
    } finally {
      if (trial) this.trialInFlight = false;
    }
  }
}

export class MockM2PreferencesClient implements M2PreferencesClient {
  private preferences = new Map<number, UserPreferences>();
  private shouldFail: boolean = false;

  setPreferences(userId: number, preferences: Partial<UserPreferences>): void {
    const existing = this.preferences.get(userId) ?? {
      userId,
      notificationsEnabled: true,
      pushEnabled: true,
    };
    this.preferences.set(userId, { ...existing, ...preferences });
  }

  setShouldFail(shouldFail: boolean): void {
    this.shouldFail = shouldFail;
  }

  async getPreferences(userId: number): Promise<UserPreferences> {
    if (this.shouldFail) {
      throw new Error('[M2_CLIENT_ERROR] M2 Service Unavailable (503)');
    }

    return (
      this.preferences.get(userId) ?? {
        userId,
        notificationsEnabled: true,
        pushEnabled: true,
      }
    );
  }
}
