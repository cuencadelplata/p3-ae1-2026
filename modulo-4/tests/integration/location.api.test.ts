import supertest from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { MockGeocodingAdapter } from '../../src/infrastructure/geocoding/mock-geocoding.adapter.js';
import { MemoryLocationHistoryRepository } from '../../src/infrastructure/postgres/memory-location-history.repository.js';
import { MemoryLocationRepository } from '../../src/infrastructure/redis/memory-location.repository.js';

describe('Location API Endpoints (M4 - Requerimientos 1, 3, 4 y 5)', () => {
  let repository: MemoryLocationRepository;
  let historyRepository: MemoryLocationHistoryRepository;
  let app: ReturnType<typeof createApp>;
  let client: ReturnType<typeof supertest>;

  beforeEach(() => {
    repository = new MemoryLocationRepository();
    historyRepository = new MemoryLocationHistoryRepository();
    app = createApp({
      locationRepository: repository,
      historyRepository,
      geocodingProvider: new MockGeocodingAdapter()
    });
    client = supertest(app);
  });

  it('PUT & GET /api/v1/drivers/:driverId/location debe guardar y consultar la ubicación del conductor', async () => {
    const putRes = await client
      .put('/api/v1/drivers/77/location') // driverId entero canónico
      .send({
        latitude: -27.4692,
        longitude: -58.8306,
        vehicleType: 'AUTO',
        available: true
      });

    expect(putRes.status).toBe(200);
    expect(putRes.body.driverId).toBe(77);

    const getRes = await client.get('/api/v1/drivers/77/location');
    expect(getRes.status).toBe(200);
    expect(getRes.body.latitude).toBe(-27.4692);
  });

  it('GET /api/v1/drivers/:driverId/location-history debe devolver el historial de PostgreSQL (Requerimiento 4)', async () => {
    await client
      .put('/api/v1/drivers/77/location')
      .send({
        latitude: -27.4692,
        longitude: -58.8306,
        vehicleType: 'AUTO',
        available: true
      });

    const res = await client.get('/api/v1/drivers/77/location-history?limit=10');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBe(1);
    expect(res.body[0].driverId).toBe(77);
  });

  it('GET /api/v1/drivers/nearby debe devolver conductores cercanos con el formato para M5 (Requerimiento 5)', async () => {
    await client
      .put('/api/v1/drivers/101/location')
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
    expect(res.body).toHaveProperty('vehicleType', 'AUTO');
    expect(res.body).toHaveProperty('searchRadiusKm', 5);
    expect(res.body).toHaveProperty('count', 1);
    expect(Array.isArray(res.body.drivers)).toBe(true);
    expect(res.body.drivers[0].driverId).toBe(101);
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
