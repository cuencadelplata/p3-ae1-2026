import type { RequestHandler } from 'express';
export const TEST_CLIENT_ID = '11111111-1111-4111-8111-111111111111';
// Inyeccion explicita exclusiva de tests; el servidor instala la autenticacion real.
export const testAuthentication: RequestHandler = (_request, response, next) => {
  response.locals.clientId = TEST_CLIENT_ID;
  next();
};
