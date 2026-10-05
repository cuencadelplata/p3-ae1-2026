import { createHmac, timingSafeEqual } from 'node:crypto';
import { RequestHandler } from 'express';
import { ApiError, identifier } from './domain';
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
// Adaptador de identidad de demostración. Reemplazar por validación OIDC de M1 al integrar.
export const authenticate: RequestHandler = (req,res,next) => {
  try {
    const secret=process.env.AUTH_SECRET;
    if (!secret || secret.length < 32) throw new Error('AUTH_SECRET debe tener al menos 32 caracteres');
    const bearer=req.get('authorization');
    if (!bearer?.startsWith('Bearer ')) throw new ApiError(401,'UNAUTHORIZED','Se requiere Bearer token');
    res.locals.clienteId=verifyToken(bearer.slice(7),secret);
    // Compatibilidad RF-2.4: el cliente no puede suplantar la identidad con un header.
    req.headers['x-cliente-id']=res.locals.clienteId;
    next();
  } catch(e) { next(e); }
};
