import jwt from 'jsonwebtoken';
import { z } from 'zod';
import type { DispatchTokenProvider } from './m5-dispatch.client.js';
import { AppError } from '../errors/app.error.js';
import { getRequestContext } from '../integration/request-context.js';

// Contrato de delegacion pendiente de publicar por M1. No fabrica JWT ni conserva sesiones de pasajeros.
export class DelegatedDispatchTokenProvider implements DispatchTokenProvider {
  public constructor(
    private readonly endpoint: string | undefined,
    private readonly credential: string | undefined,
    private readonly m1BaseUrl: string,
    private readonly timeoutMs = 3000,
  ) {}
  public async getAuthorization(clienteId?: string): Promise<string | undefined> {
    const current = getRequestContext()?.authorization;
    if (current) {
      // Esta sesion ya fue autenticada por el middleware de M1; no alcanza con decodificar un JWT.
      if (!clienteId || !this.matchesSubject(current.slice(7), clienteId, 0))
        throw new AppError(
          401,
          'IDENTIDAD_DESPACHO_INVALIDA',
          'La sesion no representa al cliente de la reserva.',
        );
      return current;
    }
    if (!clienteId || !this.endpoint || !this.credential)
      throw new AppError(
        503,
        'DELEGACION_NO_CONFIGURADA',
        'La activacion automatica requiere autenticacion de servicio delegada por cliente.',
      );
    try {
      const response = await fetch(this.endpoint, {
        method: 'POST',
        redirect: 'error',
        headers: { authorization: 'Bearer ' + this.credential, 'content-type': 'application/json' },
        body: JSON.stringify({ clientId: clienteId, audience: 'm5', scope: 'ride-requests:write' }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!response.ok) throw new Error('broker');
      const { access_token } = z
        .object({ access_token: z.string().min(1) })
        .parse(await response.json());
      const authorization = 'Bearer ' + access_token;
      const validation = await fetch(new URL('/auth/validar-identidad-y-rol', this.m1BaseUrl), {
        redirect: 'error',
        headers: { authorization },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!validation.ok) throw new Error('validation');
      const identity = z
        .object({
          valid: z.literal(true),
          userId: z.union([z.number().int().positive(), z.string().min(1)]),
          role: z.literal('CLIENTE'),
        })
        .parse(await validation.json());
      if (String(identity.userId) !== clienteId) throw new Error('identity');
      // M1 ya verifico la firma. Comprobar tambien la identidad que interpretara M5.
      if (!this.matchesSubject(access_token, clienteId, 30)) throw new Error('dispatch-subject');
      return authorization;
    } catch {
      throw new AppError(
        503,
        'DELEGACION_NO_DISPONIBLE',
        'No se obtuvo una credencial valida para el cliente de la reserva.',
      );
    }
  }
  private matchesSubject(token: string, clienteId: string, remainingSeconds: number): boolean {
    const claims = jwt.decode(token);
    return (
      !!claims &&
      typeof claims !== 'string' &&
      String(claims.sub ?? claims.userId) === clienteId &&
      typeof claims.exp === 'number' &&
      claims.exp > Math.floor(Date.now() / 1000) + remainingSeconds
    );
  }
}
