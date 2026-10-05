import supertest from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { MockGeocodingAdapter } from '../../src/infrastructure/geocoding/mock-geocoding.adapter.js';
import { MemoryLocationRepository } from '../../src/infrastructure/redis/memory-location.repository.js';

describe('Location API Endpoints (M4)', () => {
  let repository: MemoryLocationRepository;
  let app: ReturnType<typeof createApp>;
  let client: ReturnType<typeof supertest>;

  beforeEach(() => {
    repository = new MemoryLocationRepository();
    app = createApp({
      locationRepository: repository,
      geocodingProvider: new MockGeocodingAdapter()
    });
    client = supertest(app);
  });

  it('PUT & GET /api/v1/drivers/:driverId/location debe guardar y consultar la ubicación del conductor', async () => {
    const putRes = await client
      .put('/api/v1/drivers/driver-77/location')
      .send({
        latitude: -27.4692,
        longitude: -58.8306,
        vehicleType: 'AUTO',
        available: true
      });

    expect(putRes.status).toBe(200);
    expect(putRes.body.driverId).toBe('driver-77');

    const getRes = await client.get('/api/v1/drivers/driver-77/location');
    expect(getRes.status).toBe(200);
    expect(getRes.body.latitude).toBe(-27.4692);
  });

  it('GET /api/v1/drivers/nearby debe devolver conductores cercanos', async () => {
    await client
      .put('/api/v1/drivers/driver-nearby-1/location')
      .send({
        latitude: -27.4695,
        longitude: -58.8310,
        vehicleType: 'AUTO',
        available: true
      });

    const res = await client.get(
      '/api/v1/drivers/nearby?latitude=-27.4692&longitude=-58.8306&vehicleType=AUTO&radiusKm=5'
    );

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.drivers)).toBe(true);
    expect(res.body.drivers.length).toBeGreaterThanOrEqual(1);
  });

  it('POST /api/v1/geocode debe geocodificar una dirección', async () => {
    const res = await client.post('/api/v1/geocode').send({
      address: 'Plaza 25 de Mayo, Corrientes'
    });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('latitude');
    expect(res.body).toHaveProperty('longitude');
  });

  it('POST /api/v1/estimate debe calcular distancia y ETA entre origen y destino', async () => {
    const res = await client.post('/api/v1/estimate').send({
      origin: { latitude: -27.4692, longitude: -58.8306 },
      destination: { latitude: -27.4875, longitude: -58.7896 }
    });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('distanceKm');
    expect(res.body).toHaveProperty('estimatedEtaMinutes');
  });
});
