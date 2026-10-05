import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import {
  AuthenticationError,
  IdentityServiceUnavailableError,
  type IdentityValidator
} from '../src/auth/identity.types.js';
import { MemoryLocationHistoryRepository } from '../src/repositories/memory-location-history.repository.js';
import { MemoryLocationRepository } from '../src/repositories/memory-location.repository.js';
import { LocationService } from '../src/services/location.service.js';

const identityValidator: IdentityValidator = {
  async validate(authorizationHeader) {
    if (!authorizationHeader) throw new AuthenticationError('Token Bearer requerido');
    if (authorizationHeader === 'Bearer unavailable') {
      throw new IdentityServiceUnavailableError('M1 no se encuentra disponible');
    }
    return { userId: 13, role: 'CONDUCTOR' };
  }
};

const service = new LocationService(
  new MemoryLocationRepository(),
  60,
  Date.now,
  new MemoryLocationHistoryRepository()
);
const authenticatedApp = createApp(service, async () => undefined, identityValidator);
const locationBody = {
  latitude: -27.4692,
  longitude: -58.8306,
  vehicleType: 'AUTO',
  available: true
};

describe('Proteccion de endpoints de conductor', () => {
  beforeEach(async () => service.clear());

  it('permite operar cuando el userId de M1 coincide con driverId', async () => {
    const response = await request(authenticatedApp)
      .put('/api/v1/drivers/13/location')
      .set('Authorization', 'Bearer valido')
      .send(locationBody)
      .expect(200);

    expect(response.body.driverId).toBe(13);
  });

  it('devuelve 401 cuando falta el token', async () => {
    const response = await request(authenticatedApp)
      .put('/api/v1/drivers/13/location')
      .send(locationBody)
      .expect(401);

    expect(response.body.code).toBe('UNAUTHORIZED');
  });

  it('devuelve 403 si se intenta operar sobre otro conductor', async () => {
    const response = await request(authenticatedApp)
      .put('/api/v1/drivers/14/location')
      .set('Authorization', 'Bearer valido')
      .send(locationBody)
      .expect(403);

    expect(response.body.code).toBe('FORBIDDEN');
  });

  it('devuelve 503 cuando M1 no esta disponible', async () => {
    const response = await request(authenticatedApp)
      .put('/api/v1/drivers/13/location')
      .set('Authorization', 'Bearer unavailable')
      .send(locationBody)
      .expect(503);

    expect(response.body.code).toBe('IDENTITY_SERVICE_UNAVAILABLE');
  });
});
