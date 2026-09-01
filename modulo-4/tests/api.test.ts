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

  it('valida coordenadas incorrectas', async () => {
    const response = await request(app).put('/api/v1/drivers/driver-1/location').send({
      latitude: 120,
      longitude: -58.8306,
      vehicleType: 'AUTO',
      available: true
    }).expect(400);

    expect(response.body.code).toBe('VALIDATION_ERROR');
  });

  it('geocodifica una direccion conocida con el proveedor simulado', async () => {
    const response = await request(app)
      .post('/api/v1/geocode')
      .send({ address: 'Facultad Cuenca del Plata' })
      .expect(200);

    expect(response.body.provider).toBe('SIMULATED');
  });
});
