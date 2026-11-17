import { createHmac, timingSafeEqual } from 'node:crypto';
import { RequestHandler } from 'express';
import { ApiError, identifier } from './domain';
import { requireAuth } from '../middlewares/auth.middleware';
export function verifyToken(token: string, secret: string) {
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra) throw new ApiError(401,'UNAUTHORIZED','Token inválido');
  const expected = createHmac('sha256',secret).update(payload).digest();
  const supplied = Buffer.from(signature,'base64url');
  if (expected.length !== supplied.length || !timingSafeEqual(expected,supplied)) throw new ApiError(401,'UNAUTHORIZED','Token inválido');
  let claims: any;
  try { claims=JSON.parse(Buffer.from(payload,'base64url').toString()); } catch { throw new ApiError(401,'UNAUTHORIZED','Token inválido'); }
  if (!identifier.safeParse(claims.sub).success || claims.role !== 'Cliente' || claims.aud !== 'm2' || !Number.isInteger(claims.exp) || claims.exp <= Date.now()/1000)
    throw new ApiError(401,'UNAUTHORIZED','Token inválido o vencido');
  return claims.sub as string;
}
// Identidad integrada con el resto de M2: el token lo emite y valida M1 (requireAuth).
// El clienteId de RF-2.2 / RF-2.4 es el userId de M1 como texto, el mismo usuario dueño
// del perfil de RF-2.1, así direcciones, calificaciones y perfil quedan vinculados.
// verifyToken (token HMAC de demostración de AE2) se conserva solo por compatibilidad.
const requireCliente = requireAuth({ roles: ['CLIENTE'] });
export const authenticate: RequestHandler = (req,res,next) => {
  requireCliente(req,res,(error?: unknown) => {
    if (error) return next(error);
    res.locals.clienteId=String(req.auth!.userId);
    // Compatibilidad RF-2.4: el cliente no puede suplantar la identidad con un header.
    req.headers['x-cliente-id']=res.locals.clienteId;
    next();
  });
};
