import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { app, locationService } from '../src/app.js';

describe('API M4', () => {
  beforeEach(() => locationService.clear());

  it('publica ubicacion y devuelve el conductor en una busqueda cercana', async () => {
    await request(app).put('/api/v1/drivers/driver-1/location').send({
      latitude: -27.4692,
      longitude: -58.8306,
      vehicleType: 'AUTO',
      available: true
    }).expect(200);

    const response = await request(app)
      .get('/api/v1/drivers/nearby')
      .query({ latitude: -27.4693, longitude: -58.8307, vehicleType: 'AUTO' })
      .expect(200);

    expect(response.body.count).toBe(1);
    expect(response.body.drivers[0].driverId).toBe('driver-1');
  });

  it('acepta maxCandidates como lo utiliza el contrato de M5', async () => {
    for (const [driverId, latitude] of [['driver-1', -27.4692], ['driver-2', -27.47]]) {
      await request(app).put(`/api/v1/drivers/${driverId}/location`).send({
        latitude,
        longitude: -58.8306,
        vehicleType: 'AUTO',
        available: true
      }).expect(200);
    }

    const response = await request(app)
      .get('/api/v1/drivers/nearby')
      .query({
        latitude: -27.4692,
        longitude: -58.8306,
        vehicleType: 'AUTO',
        radiusKm: 5,
        maxCandidates: 1
      })
      .expect(200);

    expect(response.body.candidatesCount).toBe(1);
    expect(response.body.drivers).toHaveLength(1);
    expect(response.body.searchRadiusKm).toBe(5);
    expect(response.body.vehicleType).toBe('AUTO');
    expect(response.body.searchTimestamp).toBeDefined();
  });

  it('valida coordenadas incorrectas', async () => {
    const response = await request(app).put('/api/v1/drivers/driver-1/location').send({
      latitude: 120,
      longitude: -58.8306,
      vehicleType: 'AUTO',
      available: true
    }).expect(400);

    expect(response.body.code).toBe('VALIDATION_ERROR');
  });

  it('rechaza una ubicacion con marca temporal futura', async () => {
    const futureTimestamp = new Date(Date.now() + 60_000).toISOString();
    const response = await request(app).put('/api/v1/drivers/driver-1/location').send({
      latitude: -27.4692,
      longitude: -58.8306,
      vehicleType: 'AUTO',
      available: true,
      timestamp: futureTimestamp
    }).expect(400);

    expect(response.body.code).toBe('LOCATION_VALIDATION_ERROR');
  });

  it('elimina la ubicacion de un conductor', async () => {
    await request(app).put('/api/v1/drivers/driver-1/location').send({
      latitude: -27.4692,
      longitude: -58.8306,
      vehicleType: 'AUTO',
      available: true
    }).expect(200);

    await request(app).delete('/api/v1/drivers/driver-1/location').expect(204);

    await request(app).get('/api/v1/drivers/driver-1/location').expect(404);
  });

  it('devuelve 404 al eliminar un conductor sin ubicacion registrada', async () => {
    await request(app).delete('/api/v1/drivers/driver-x/location').expect(404);
  });

  it('geocodifica una direccion conocida con el proveedor simulado', async () => {
    const response = await request(app)
      .post('/api/v1/geocode')
      .send({ address: 'Facultad Cuenca del Plata' })
      .expect(200);

    expect(response.body.provider).toBe('SIMULATED');
  });

  it('responde 409 y conserva el dato nuevo ante una actualizacion atrasada', async () => {
    const recent = new Date(Date.now() - 5_000).toISOString();
    const stale = new Date(Date.now() - 10_000).toISOString();

    await request(app).put('/api/v1/drivers/driver-1/location').send({
      latitude: -27.4692,
      longitude: -58.8306,
      vehicleType: 'AUTO',
      timestamp: recent
    }).expect(200);

    const response = await request(app).put('/api/v1/drivers/driver-1/location').send({
      latitude: -27.5,
      longitude: -58.9,
      vehicleType: 'AUTO',
      timestamp: stale
    }).expect(409);

    expect(response.body.code).toBe('STALE_LOCATION_UPDATE');
    const location = await request(app).get('/api/v1/drivers/driver-1/location').expect(200);
    expect(location.body.latitude).toBe(-27.4692);
  });

  it('publica informacion del servicio sin integrar la interfaz grafica', async () => {
    const response = await request(app).get('/').expect(200);

    expect(response.headers['content-type']).toContain('application/json');
    expect(response.body).toMatchObject({ service: 'm4-location-service', version: '1.3.0' });
  });

  it('publica la documentacion local con Scalar', async () => {
    const response = await request(app).get('/docs').expect(200);

    expect(response.text).toContain('M4 - Documentacion API');
    expect(response.text).toContain('/openapi/openapi-m4.yaml');
    expect(response.text).toContain('/scalar/standalone.js');

    const scalarAsset = await request(app).get('/scalar/standalone.js').expect(200);
    expect(scalarAsset.headers['content-type']).toContain('javascript');
  });
});
