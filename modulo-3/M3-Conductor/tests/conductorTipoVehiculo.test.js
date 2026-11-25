const { test, expect } = require('@playwright/test');
const path = require('path');
const {
  createMockFn,
  mockModule,
  clearModule,
  createFakeRedis,
  createRes,
  clearAllMocks
} = require('./helpers/testUtils');

/**
 * PATCH /api/conductores/:id — corrección del tipo de vehículo desde el front
 * de alta (botón "Volver" del paso de vehículo).
 */

const SRC = path.join(__dirname, '..', 'src');
const redisClientPath = path.join(SRC, 'config', 'redisClient.js');
const redisRepoPath = path.join(SRC, 'repositories', 'redisRepository.js');
const dbRepoPath = path.join(SRC, 'repositories', 'conductorDBRepository.js');
const redisHealthPath = path.join(SRC, 'services', 'redisHealth.js');
const eventPublisherPath = path.join(SRC, 'events', 'eventPublisher.js');
const controllerPath = path.join(SRC, 'controllers', 'conductoresController.js');

const redis = createFakeRedis();
mockModule(redisClientPath, redis);
mockModule(dbRepoPath, {
  obtenerPerfilPorId: createMockFn().mockResolvedValue(null),
  obtenerHabilitadoPorId: createMockFn(),
  actualizarHabilitado: createMockFn(),
  obtenerDisponiblePorId: createMockFn(),
  actualizarDisponible: createMockFn()
});
mockModule(redisHealthPath, { isUp: createMockFn().mockReturnValue(true), markDown: createMockFn() });
mockModule(eventPublisherPath, {
  publicarDriverAvailabilityUpdated: createMockFn(),
  publicarDriverStatusChanged: createMockFn(),
  publicar: createMockFn()
});

// 1) Controller con el repositorio mockeado
const repoMock = { actualizarTipoVehiculo: createMockFn() };
mockModule(redisRepoPath, repoMock);
clearModule(controllerPath);
const { actualizarTipoVehiculo } = require('../src/controllers/conductoresController');

// 2) Repositorio real (Redis falso)
clearModule(redisRepoPath);
const redisRepository = require('../src/repositories/redisRepository');

test.describe('conductoresController.actualizarTipoVehiculo', () => {
  let res;
  test.beforeEach(() => {
    clearAllMocks(repoMock.actualizarTipoVehiculo);
    res = createRes();
  });

  test('normaliza a minúscula y responde 200 con el conductor actualizado', async () => {
    const actualizado = { usuarioID: '101', tipovehiculo: 'moto' };
    repoMock.actualizarTipoVehiculo.mockResolvedValue(actualizado);

    await actualizarTipoVehiculo({ params: { id: '101' }, body: { tipovehiculo: 'MOTO' } }, res);

    expect(repoMock.actualizarTipoVehiculo.calls[0]).toEqual(['101', 'moto']);
    expect(res.status.calls[0][0]).toBe(200);
    expect(res.json.calls[0][0]).toEqual(actualizado);
  });

  test('rechaza con 400 un tipo que no sea auto/moto', async () => {
    await actualizarTipoVehiculo({ params: { id: '101' }, body: { tipovehiculo: 'camion' } }, res);

    expect(repoMock.actualizarTipoVehiculo.calls.length).toBe(0);
    expect(res.status.calls[0][0]).toBe(400);
  });

  test('responde 404 si el conductor no existe', async () => {
    repoMock.actualizarTipoVehiculo.mockResolvedValue(null);

    await actualizarTipoVehiculo({ params: { id: '999' }, body: { tipovehiculo: 'auto' } }, res);

    expect(res.status.calls[0][0]).toBe(404);
  });

  test('responde 500 si el repositorio falla', async () => {
    repoMock.actualizarTipoVehiculo.mockRejectedValue(new Error('boom'));

    await actualizarTipoVehiculo({ params: { id: '101' }, body: { tipovehiculo: 'auto' } }, res);

    expect(res.status.calls[0][0]).toBe(500);
  });
});

test.describe('redisRepository.actualizarTipoVehiculo', () => {
  test.beforeEach(() => {
    clearAllMocks(redis.get, redis.set);
    redis.get.mockResolvedValue(null);
    redis.set.mockResolvedValue('OK');
  });

  test('actualiza el tipo conservando el resto del conductor y lo guarda en Redis', async () => {
    redis.get.mockResolvedValue(JSON.stringify({ usuarioID: '101', tipovehiculo: 'auto', habilitado: 'pendiente' }));

    const resultado = await redisRepository.actualizarTipoVehiculo('101', 'moto');

    expect(resultado).toMatchObject({ usuarioID: '101', tipovehiculo: 'moto', habilitado: 'pendiente' });
    const [clave, valor] = redis.set.calls[0];
    expect(clave).toBe('conductor:101');
    expect(JSON.parse(valor).tipovehiculo).toBe('moto');
  });

  test('devuelve null si el conductor no existe', async () => {
    const resultado = await redisRepository.actualizarTipoVehiculo('no-existe', 'moto');

    expect(resultado).toBeNull();
    expect(redis.set.calls.length).toBe(0);
  });

  test('si Redis falla, igual actualiza el fallback en memoria', async () => {
    redis.get.mockResolvedValue(JSON.stringify({ usuarioID: '202', tipovehiculo: 'auto' }));
    redis.set.mockRejectedValue(new Error('redis caído'));

    const resultado = await redisRepository.actualizarTipoVehiculo('202', 'moto');
    expect(resultado.tipovehiculo).toBe('moto');

    redis.get.mockRejectedValue(new Error('redis caído'));
    const leido = await redisRepository.obtenerConductorPorId('202');
    expect(leido.tipovehiculo).toBe('moto');
  });
});
