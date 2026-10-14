import type { UserPreferences } from '../../domain/delivery.types.js';

export interface M2PreferencesClient {
  getPreferences(userId: number, correlationId: string): Promise<UserPreferences>;
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
          // Si el usuario no tiene preferencias explicitas en M2, por defecto asumimos activadas
          return { userId, notificationsEnabled: true, pushEnabled: true };
        }
        throw new Error(`M2 retornó error HTTP ${response.status}: ${response.statusText}`);
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
        throw new Error('M2 respondió preferencias con un formato inválido.');
      }

      return {
        userId,
        notificationsEnabled: data.notificationsEnabled,
        pushEnabled: data.pushEnabled,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Error desconocido al contactar M2';
      throw new Error(`[M2_CLIENT_ERROR] Falla al consultar preferencias de ${userId}: ${message}`);
    } finally {
      clearTimeout(timeout);
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
