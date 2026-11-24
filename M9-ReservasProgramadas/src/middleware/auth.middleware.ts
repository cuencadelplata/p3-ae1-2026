import type { RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import { clientIdentity } from '../domain/client-identity.js';
import { AppError } from '../errors/app.error.js';

export interface AuthOptions {
  mode?: 'm1' | 'demo';
  m1BaseUrl?: string;
  timeoutMs?: number;
  demoSecret?: string;
}
export const createAuthentication =
  (options: AuthOptions = {}): RequestHandler =>
  async (request, response, next) => {
    const authorization = request.header('authorization');
    if (!authorization || !/^Bearer \S+$/i.test(authorization)) {
      response.setHeader('WWW-Authenticate', 'Bearer');
      throw new AppError(401, 'TOKEN_REQUERIDO', 'Se requiere una sesion de M1.');
    }
    let identity: unknown;
    let role: unknown;
    if (options.mode === 'demo') {
      if (!options.demoSecret || options.demoSecret.length < 32)
        throw new AppError(503, 'AUTH_NO_CONFIGURADA', 'Falta configurar la autenticacion.');
      try {
        const payload = jwt.verify(authorization.slice(7), options.demoSecret, {
          algorithms: ['HS256'],
        });
        if (typeof payload === 'string' || typeof payload.exp !== 'number')
          throw new Error('invalid');
        identity = payload.sub;
        role = payload.role;
      } catch {
        throw new AppError(401, 'TOKEN_INVALIDO', 'Sesion invalida o vencida.');
      }
    } else {
      let result;
      try {
        result = await fetch(
          new URL(
            '/auth/validar-identidad-y-rol',
            options.m1BaseUrl ?? 'http://m1-identidad-acceso:3001',
          ),
          {
            headers: { authorization },
            redirect: 'error',
            signal: AbortSignal.timeout(options.timeoutMs ?? 3000),
          },
        );
      } catch (cause) {
        throw new AppError(503, 'IDENTIDAD_NO_DISPONIBLE', 'No se puede validar la sesion en M1.', {
          cause,
        });
      }
      if (result.status === 401 || result.status === 403)
        throw new AppError(401, 'TOKEN_INVALIDO', 'Sesion invalida o vencida.');
      if (!result.ok)
        throw new AppError(503, 'IDENTIDAD_NO_DISPONIBLE', 'No se puede validar la sesion en M1.');
      let body;
      try {
        body = (await result.json()) as { valid?: boolean; userId?: unknown; role?: unknown };
      } catch {
        throw new AppError(503, 'IDENTIDAD_NO_DISPONIBLE', 'Respuesta invalida de M1.');
      }
      if (!body || body.valid !== true)
        throw new AppError(401, 'TOKEN_INVALIDO', 'Sesion invalida o revocada.');
      identity =
        typeof body.userId === 'number' && Number.isSafeInteger(body.userId)
          ? String(body.userId)
          : body.userId;
      role = body.role;
    }
    const parsed = clientIdentity.safeParse(identity);
    if (!parsed.success)
      throw new AppError(401, 'IDENTIDAD_INVALIDA', 'La sesion no identifica al cliente.');
    if (role !== 'CLIENTE')
      throw new AppError(403, 'ROL_NO_PERMITIDO', 'Se requiere el rol CLIENTE.');
    response.locals.clientId = parsed.data;
    next();
  };
