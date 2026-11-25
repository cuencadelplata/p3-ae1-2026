const { test, expect } = require('@playwright/test');
const path = require('path');
const {
  createMockFn,
  mockModule,
  clearModule,
  createFakeRedis,
  clearAllMocks
} = require('./helpers/testUtils');

const SRC = path.join(__dirname, '..', 'src');
const redisClientPath = path.join(SRC, 'config', 'redisClient.js');
const dbRepoPath = path.join(SRC, 'repositories', 'conductorDBRepository.js');
const redisHealthPath = path.join(SRC, 'services', 'redisHealth.js');
const redisRepoPath = path.join(SRC, 'repositories', 'redisRepository.js');

const redis = createFakeRedis();
mockModule(redisClientPath, redis);

const conductorDBRepository = {
  obtenerPerfilPorId: createMockFn(),
  obtenerHabilitadoPorId: createMockFn(),
  actualizarHabilitado: createMockFn(),
  obtenerDisponiblePorId: createMockFn(),
  actualizarDisponible: createMockFn()
};
mockModule(dbRepoPath, conductorDBRepository);

const redisHealth = {
  isUp: createMockFn().mockReturnValue(true),
  markDown: createMockFn()
};
mockModule(redisHealthPath, redisHealth);

clearModule(redisRepoPath);
const redisRepository = require('../src/repositories/redisRepository');

test.beforeEach(() => {
  clearAllMocks(
    redis.get,
    redis.set,
    redis.exists,
    redis.smembers,
    redis.sadd,
    redis.lrange,
    redis.rpush,
    conductorDBRepository.obtenerPerfilPorId,
    conductorDBRepository.obtenerHabilitadoPorId,
    conductorDBRepository.actualizarHabilitado,
    conductorDBRepository.obtenerDisponiblePorId,
    conductorDBRepository.actualizarDisponible,
    redisHealth.isUp,
    redisHealth.markDown
  );
  redis.get.mockResolvedValue(null);
  redis.set.mockResolvedValue('OK');
  redisHealth.isUp.mockReturnValue(true);
  conductorDBRepository.obtenerPerfilPorId.mockResolvedValue(null);
  conductorDBRepository.obtenerDisponiblePorId.mockResolvedValue(null);
  conductorDBRepository.actualizarDisponible.mockResolvedValue({ usuarioID: 'cond_001', disponible: false });
});

test.describe('redisRepository.obtenerHabilitado (RF 3.1 - cache-aside con TTL)', () => {
  test('en un cache miss consulta la base de datos y guarda el resultado en Redis con TTL', async () => {
    redis.get.mockResolvedValue(null);
    conductorDBRepository.obtenerHabilitadoPorId.mockResolvedValue({
      usuarioID: 'cond_001',
      habilitado: 'activo'
    });

    const resultado = await redisRepository.obtenerHabilitado('cond_001');

    expect(redis.get.calls[0][0]).toBe('conductor:cond_001:habilitado');
    expect(conductorDBRepository.obtenerHabilitadoPorId.calls[0][0]).toBe('cond_001');
    expect(redis.set.calls[0][0]).toBe('conductor:cond_001:habilitado');
    expect(redis.set.calls[0][1]).toBe(JSON.stringify({ usuarioID: 'cond_001', habilitado: 'activo' }));
    expect(redis.set.calls[0][2]).toBe('EX');
    expect(typeof redis.set.calls[0][3]).toBe('number');
    expect(resultado).toEqual({ usuarioID: 'cond_001', habilitado: 'activo', origen: 'db' });
  });

  test('en un cache hit NO consulta la base de datos', async () => {
    redis.get.mockResolvedValue(JSON.stringify({ usuarioID: 'cond_001', habilitado: 'activo' }));

    const resultado = await redisRepository.obtenerHabilitado('cond_001');

    expect(conductorDBRepository.obtenerHabilitadoPorId.calls.length).toBe(0);
    expect(resultado).toEqual({ usuarioID: 'cond_001', habilitado: 'activo', origen: 'cache' });
  });

  test('devuelve null si el conductor no existe ni en caché ni en base de datos', async () => {
    redis.get.mockResolvedValue(null);
    conductorDBRepository.obtenerHabilitadoPorId.mockResolvedValue(null);

    const resultado = await redisRepository.obtenerHabilitado('no_existe');

    expect(resultado).toBeNull();
    expect(redis.set.calls.length).toBe(0);
  });

  test('omite Redis cuando redisHealth.isUp() es false y consulta directamente la BD', async () => {
    redisHealth.isUp.mockReturnValue(false);
    conductorDBRepository.obtenerHabilitadoPorId.mockResolvedValue({
      usuarioID: 'cond_001',
      habilitado: 'activo'
    });

    const resultado = await redisRepository.obtenerHabilitado('cond_001');

    expect(redis.get.calls.length).toBe(0);
    expect(redis.set.calls.length).toBe(0);
    expect(conductorDBRepository.obtenerHabilitadoPorId.calls[0][0]).toBe('cond_001');
    expect(resultado).toEqual({ usuarioID: 'cond_001', habilitado: 'activo', origen: 'db' });
  });

  test('llama a redisHealth.markDown(err) cuando falla redis.get o redis.set y cae a la BD', async () => {
    const getErr = new Error('Redis get timeout');
    const setErr = new Error('Redis set timeout');
    redis.get.mockRejectedValue(getErr);
    redis.set.mockRejectedValue(setErr);
    conductorDBRepository.obtenerHabilitadoPorId.mockResolvedValue({
      usuarioID: 'cond_001',
      habilitado: 'suspendido'
    });

    const resultado = await redisRepository.obtenerHabilitado('cond_001');

    expect(redisHealth.markDown.calls.length).toBe(2);
    expect(redisHealth.markDown.calls[0][0]).toBe(getErr);
    expect(redisHealth.markDown.calls[1][0]).toBe(setErr);
    expect(resultado).toEqual({ usuarioID: 'cond_001', habilitado: 'suspendido', origen: 'db' });
  });
});

test.describe('redisRepository.obtenerDisponibilidad (RF 3.3 - caché con fallback y sincronización en BD)', () => {
  test('con Redis UP y clave presente devuelve disponible sin tocar BD', async () => {
    redis.get.mockResolvedValue(JSON.stringify({ disponible: true }));

    const resultado = await redisRepository.obtenerDisponibilidad('cond_001');

    expect(redis.get.calls[0][0]).toBe('conductor:cond_001:disponible');
    expect(resultado).toEqual({ usuarioID: 'cond_001', disponible: true });
    expect(conductorDBRepository.obtenerDisponiblePorId.calls.length).toBe(0);
    expect(conductorDBRepository.actualizarDisponible.calls.length).toBe(0);
  });

  test('con Redis UP y sin clave (heartbeat vencido), consulta obtenerDisponiblePorId y sincroniza a false si estaba en true en BD', async () => {
    redis.get.mockResolvedValue(null);
    conductorDBRepository.obtenerDisponiblePorId.mockResolvedValue({
      usuarioID: 'cond_002',
      disponible: true
    });

    const resultado = await redisRepository.obtenerDisponibilidad('cond_002');

    expect(conductorDBRepository.obtenerDisponiblePorId.calls[0][0]).toBe('cond_002');
    expect(conductorDBRepository.actualizarDisponible.calls[0]).toEqual(['cond_002', false]);
    expect(resultado).toEqual({ usuarioID: 'cond_002', disponible: false });
  });

  test('con Redis UP y sin clave, no llama a actualizarDisponible si en BD ya estaba en false', async () => {
    redis.get.mockResolvedValue(null);
    conductorDBRepository.obtenerDisponiblePorId.mockResolvedValue({
      usuarioID: 'cond_002',
      disponible: false
    });

    const resultado = await redisRepository.obtenerDisponibilidad('cond_002');

    expect(conductorDBRepository.obtenerDisponiblePorId.calls[0][0]).toBe('cond_002');
    expect(conductorDBRepository.actualizarDisponible.calls.length).toBe(0);
    expect(resultado).toEqual({ usuarioID: 'cond_002', disponible: false });
  });

  test('cuando redis.get falla, marca Redis DOWN y obtiene la disponibilidad desde conductorDBRepository.obtenerDisponiblePorId', async () => {
    const err = new Error('Connection lost');
    redis.get.mockRejectedValue(err);
    conductorDBRepository.obtenerDisponiblePorId.mockResolvedValue({
      usuarioID: 'cond_001',
      disponible: true
    });

    const resultado = await redisRepository.obtenerDisponibilidad('cond_001');

    expect(redisHealth.markDown.calls.length).toBe(1);
    expect(redisHealth.markDown.calls[0][0]).toBe(err);
    expect(conductorDBRepository.obtenerDisponiblePorId.calls[0][0]).toBe('cond_001');
    expect(resultado).toEqual({ usuarioID: 'cond_001', disponible: true });
  });

  test('cuando redisHealth.isUp() es false, omite Redis y obtiene disponibilidad desde BD (con fallback a memoria si BD falla)', async () => {
    // Primero dejamos en memoria disponible=true para cond_mem
    redis.get.mockResolvedValue(null);
    await redisRepository.actualizarDisponibilidad('cond_mem', true);

    clearAllMocks(
      redis.get,
      redis.set,
      conductorDBRepository.obtenerDisponiblePorId,
      conductorDBRepository.actualizarDisponible,
      redisHealth.markDown
    );

    redisHealth.isUp.mockReturnValue(false);
    conductorDBRepository.obtenerDisponiblePorId.mockRejectedValue(new Error('DB down'));

    const resultado = await redisRepository.obtenerDisponibilidad('cond_mem');

    expect(redis.get.calls.length).toBe(0);
    expect(conductorDBRepository.obtenerDisponiblePorId.calls[0][0]).toBe('cond_mem');
    expect(resultado).toEqual({ usuarioID: 'cond_mem', disponible: true });
  });
});

test.describe('redisRepository.actualizarDisponibilidad', () => {
  test('consulta el estado previo, setea la clave con TTL y persiste en BD cuando el valor cambió', async () => {
    redis.get.mockResolvedValue(null);

    const resultado = await redisRepository.actualizarDisponibilidad('cond_001', true);

    expect(redis.get.calls[0][0]).toBe('conductor:cond_001:disponible');
    expect(redis.set.calls[0][0]).toBe('conductor:cond_001:disponible');
    expect(redis.set.calls[0][1]).toBe(JSON.stringify({ usuarioID: 'cond_001', disponible: true }));
    expect(redis.set.calls[0][2]).toBe('EX');
    expect(typeof redis.set.calls[0][3]).toBe('number');
    expect(conductorDBRepository.actualizarDisponible.calls).toEqual([['cond_001', true]]);
    expect(resultado).toEqual({
      usuarioID: 'cond_001',
      disponible: true,
      disponibleAnterior: false
    });
  });

  test('devuelve disponibleAnterior=true y actualiza BD cuando cambia de true a false', async () => {
    redis.get.mockResolvedValue(JSON.stringify({ usuarioID: 'cond_001', disponible: true }));

    const resultado = await redisRepository.actualizarDisponibilidad('cond_001', false);

    expect(redis.get.calls[0][0]).toBe('conductor:cond_001:disponible');
    expect(conductorDBRepository.actualizarDisponible.calls).toEqual([['cond_001', false]]);
    expect(resultado).toEqual({
      usuarioID: 'cond_001',
      disponible: false,
      disponibleAnterior: true
    });
  });

  test('NO escribe en BD si el heartbeat repite el mismo valor (disponible === disponibleAnterior)', async () => {
    redis.get.mockResolvedValue(JSON.stringify({ usuarioID: 'cond_001', disponible: true }));

    const resultado = await redisRepository.actualizarDisponibilidad('cond_001', true);

    expect(conductorDBRepository.actualizarDisponible.calls.length).toBe(0);
    expect(resultado).toEqual({
      usuarioID: 'cond_001',
      disponible: true,
      disponibleAnterior: true
    });
  });

  test('si redis.set falla, llama a redisHealth.markDown(err) y aun así persiste en BD si el valor cambió', async () => {
    const err = new Error('Redis timeout');
    redis.get.mockResolvedValue(null);
    redis.set.mockRejectedValue(err);

    const resultado = await redisRepository.actualizarDisponibilidad('cond_003', true);

    expect(redisHealth.markDown.calls.length).toBe(1);
    expect(redisHealth.markDown.calls[0][0]).toBe(err);
    expect(conductorDBRepository.actualizarDisponible.calls).toEqual([['cond_003', true]]);
    expect(resultado).toEqual({
      usuarioID: 'cond_003',
      disponible: true,
      disponibleAnterior: false
    });
  });

  test('si redisHealth.isUp() es false, omite redis.set y persiste en BD si el valor cambió', async () => {
    redisHealth.isUp.mockReturnValue(false);
    conductorDBRepository.obtenerDisponiblePorId.mockResolvedValue({
      usuarioID: 'cond_004',
      disponible: false
    });

    const resultado = await redisRepository.actualizarDisponibilidad('cond_004', true);

    expect(redis.get.calls.length).toBe(0);
    expect(redis.set.calls.length).toBe(0);
    expect(conductorDBRepository.actualizarDisponible.calls).toEqual([['cond_004', true]]);
    expect(resultado).toEqual({
      usuarioID: 'cond_004',
      disponible: true,
      disponibleAnterior: false
    });
  });
});

test.describe('redisRepository.actualizarHabilitado (RF 3.1 - write-through con TTL)', () => {
  test('actualiza en la base de datos y refresca la caché de Redis con TTL', async () => {
    conductorDBRepository.actualizarHabilitado.mockResolvedValue({
      usuarioID: 'cond_001',
      habilitado: 'activo',
      habilitadoAnterior: 'pendiente'
    });

    const resultado = await redisRepository.actualizarHabilitado('cond_001', 'activo');

    expect(conductorDBRepository.actualizarHabilitado.calls[0]).toEqual(['cond_001', 'activo']);
    expect(redis.set.calls[0][0]).toBe('conductor:cond_001:habilitado');
    expect(redis.set.calls[0][1]).toBe(JSON.stringify({ usuarioID: 'cond_001', habilitado: 'activo' }));
    expect(redis.set.calls[0][2]).toBe('EX');
    expect(typeof redis.set.calls[0][3]).toBe('number');
    expect(resultado).toEqual({
      usuarioID: 'cond_001',
      habilitado: 'activo',
      habilitadoAnterior: 'pendiente'
    });
  });

  test('devuelve null y no actualiza Redis si el conductor no existe en la base de datos', async () => {
    conductorDBRepository.actualizarHabilitado.mockResolvedValue(null);

    const resultado = await redisRepository.actualizarHabilitado('inexistente', 'activo');

    expect(conductorDBRepository.actualizarHabilitado.calls[0]).toEqual(['inexistente', 'activo']);
    expect(resultado).toBeNull();
    expect(redis.set.calls.length).toBe(0);
  });

  test('si falla redis.set al refrescar la caché, llama a redisHealth.markDown(err) y retorna el resultado de BD', async () => {
    const err = new Error('Redis write failed');
    conductorDBRepository.actualizarHabilitado.mockResolvedValue({
      usuarioID: 'cond_001',
      habilitado: 'suspendido',
      habilitadoAnterior: 'activo'
    });
    redis.set.mockRejectedValue(err);

    const resultado = await redisRepository.actualizarHabilitado('cond_001', 'suspendido');

    expect(redisHealth.markDown.calls.length).toBe(1);
    expect(redisHealth.markDown.calls[0][0]).toBe(err);
    expect(resultado).toEqual({
      usuarioID: 'cond_001',
      habilitado: 'suspendido',
      habilitadoAnterior: 'activo'
    });
  });

  test('omite redis.set si redisHealth.isUp() es false', async () => {
    redisHealth.isUp.mockReturnValue(false);
    conductorDBRepository.actualizarHabilitado.mockResolvedValue({
      usuarioID: 'cond_001',
      habilitado: 'activo',
      habilitadoAnterior: 'suspendido'
    });

    const resultado = await redisRepository.actualizarHabilitado('cond_001', 'activo');

    expect(redis.set.calls.length).toBe(0);
    expect(resultado).toEqual({
      usuarioID: 'cond_001',
      habilitado: 'activo',
      habilitadoAnterior: 'suspendido'
    });
  });
});
