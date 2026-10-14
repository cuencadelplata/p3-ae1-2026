import { identityUnavailable, invalidToken } from '../errors/support-error.js';

const M1_ROLES = ['CLIENTE', 'CONDUCTOR', 'OPERADOR'] as const;

export type M1Role = (typeof M1_ROLES)[number];

export interface AuthenticatedUser {
  userId: number;
  role: M1Role;
}

// Validación de identidad contra M1. Support no decodifica el JWT ni conoce
// el secreto de M1: reenvía la cabecera Authorization tal como la recibió.
export interface IdentityVerifier {
  // Usuario dueño del token. Lanza SUPPORT_INVALID_TOKEN si M1 no lo acepta,
  // y SUPPORT_IDENTITY_UNAVAILABLE si no se pudo saber (M1 caído, lento o con
  // una respuesta fuera de contrato).
  verificar(authorization: string): Promise<AuthenticatedUser>;
  // Verificación de salud de M1, para el readiness.
  isReachable(): Promise<boolean>;
}

export interface M1IdentityClientOptions {
  baseUrl: string;
  timeoutMs: number;
  // Inyectable para las pruebas.
  fetchImpl?: typeof fetch;
}

function describir(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function esTimeout(error: unknown): boolean {
  return error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
}

// Un cuerpo que no es JSON queda como null (fuera de contrato), pero un
// timeout mientras se lee el cuerpo sigue siendo un timeout.
async function leerJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch (error) {
    if (esTimeout(error)) {
      throw error;
    }
    return null;
  }
}

function esObjeto(body: unknown): body is Record<string, unknown> {
  return typeof body === 'object' && body !== null && !Array.isArray(body);
}

// Cliente REST de M1 (GET /auth/validar-identidad-y-rol) con timeout por
// llamada.
//
// - 200 con valid: true, userId entero positivo y un rol de M1: autenticado.
// - 401 o 403, o 200 con valid: false (usuario inexistente o bloqueado): el
//   token no es válido.
// - Timeout, error de red, otro status o un cuerpo fuera de contrato: no se
//   pudo validar.
export function createM1IdentityClient({ baseUrl, timeoutMs, fetchImpl = fetch }: M1IdentityClientOptions): IdentityVerifier {
  function noDisponible(motivo: string, cause?: unknown) {
    console.warn('[Support] No se pudo validar la identidad en M1:', { motivo });
    return identityUnavailable(cause ?? new Error(motivo));
  }

  return {
    async verificar(authorization) {
      let response: Response;
      let body: unknown;
      try {
        response = await fetchImpl(`${baseUrl}/auth/validar-identidad-y-rol`, {
          headers: { Authorization: authorization },
          signal: AbortSignal.timeout(timeoutMs),
        });
        body = await leerJson(response);
      } catch (error) {
        throw noDisponible(esTimeout(error) ? `sin respuesta en ${timeoutMs} ms` : describir(error), error);
      }

      if (response.status === 401 || response.status === 403) {
        throw invalidToken();
      }
      if (!response.ok) {
        throw noDisponible(`M1 respondió ${response.status}`);
      }
      if (!esObjeto(body) || typeof body.valid !== 'boolean') {
        throw noDisponible('respuesta con formato inesperado');
      }
      if (!body.valid) {
        throw invalidToken();
      }

      const { userId, role } = body;
      if (
        typeof userId !== 'number' ||
        !Number.isInteger(userId) ||
        userId < 1 ||
        typeof role !== 'string' ||
        !(M1_ROLES as readonly string[]).includes(role)
      ) {
        throw noDisponible('respuesta con formato inesperado');
      }
      return { userId, role: role as M1Role };
    },

    async isReachable() {
      try {
        const response = await fetchImpl(`${baseUrl}/health`, { signal: AbortSignal.timeout(timeoutMs) });
        // Sólo importa el status: el cuerpo se descarta para liberar la conexión.
        await response.body?.cancel().catch(() => undefined);
        return response.ok;
      } catch {
        return false;
      }
    },
  };
}
