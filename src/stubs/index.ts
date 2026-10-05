import { Express } from 'express';
import { soporteStub } from './soporte.stub.js';
import { m6Stub } from './m6.stub.js';

/**
 * Monta los stubs en la app Express si STUBS_ENABLED=true.
 * Las rutas son:
 *   /__stubs/soporte   (modo caos: POST /__stubs/soporte/__chaos)
 *   /__stubs/m6        (modo caos: POST /__stubs/m6/__chaos)
 *
 * Para activarlos, agregar al .env:
 *   STUBS_ENABLED=true
 *   M1_SERVICE_URL=http://localhost:3000/__stubs/m1
 *   SOPORTE_SERVICE_URL=http://localhost:3000/__stubs/soporte
 *   M6_SERVICE_URL=http://localhost:3000/__stubs/m6
 */
export function mountStubs(app: Express): void {
  if (process.env.STUBS_ENABLED !== 'true') return;

  app.use('/__stubs/soporte', soporteStub);
  app.use('/__stubs/m6', m6Stub);

  console.log('[stubs] Stubs de soporte y M6 montados en /__stubs/*');
}
