import {
  AuthenticationError,
  AuthorizationError,
  IdentityServiceUnavailableError,
  type AuthenticatedIdentity,
  type IdentityValidator
} from './identity.types.js';

interface M1ValidationResponse {
  valid?: boolean;
  userId?: number;
  role?: string;
  error?: string;
}

export class M1IdentityClient implements IdentityValidator {
  private readonly validationUrl: string;

  public constructor(baseUrl: string, private readonly timeoutMs = 3_000) {
    this.validationUrl = `${baseUrl.replace(/\/$/, '')}/auth/validar-identidad-y-rol`;
  }

  public async validate(authorizationHeader?: string): Promise<AuthenticatedIdentity> {
    if (!authorizationHeader?.startsWith('Bearer ')) {
      throw new AuthenticationError('Token Bearer requerido');
    }

    let response: Response;
    try {
      response = await fetch(this.validationUrl, {
        headers: { Authorization: authorizationHeader },
        signal: AbortSignal.timeout(this.timeoutMs)
      });
    } catch {
      throw new IdentityServiceUnavailableError('M1 no se encuentra disponible');
    }

    const body = (await response.json().catch(() => ({}))) as M1ValidationResponse;
    if (response.status === 401) {
      throw new AuthenticationError(body.error ?? 'Token invalido');
    }
    if (!response.ok) {
      throw new IdentityServiceUnavailableError('M1 no pudo validar la identidad');
    }
    if (!body.valid) {
      throw new AuthenticationError(body.error ?? 'Identidad invalida');
    }
    if (!Number.isInteger(body.userId) || Number(body.userId) <= 0) {
      throw new IdentityServiceUnavailableError('M1 devolvio un userId invalido');
    }
    if (body.role !== 'CONDUCTOR') {
      throw new AuthorizationError('El usuario autenticado no tiene rol CONDUCTOR');
    }
    return { userId: Number(body.userId), role: body.role };
  }
}
