// Tests de la lógica cache-aside del repositorio de Redis, mockeando directamente
// el cliente de Redis y el repositorio de base de datos para verificar el
// comportamiento de RF 3.1 (habilitación, con TTL) y RF 3.3 (disponibilidad efímera).

jest.mock('../src/config/redisClient', () => ({
  get: jest.fn(),
  set: jest.fn(),
  exists: jest.fn(),
  smembers: jest.fn(),
  sadd: jest.fn(),
  lrange: jest.fn(),
  rpush: jest.fn(),
  on: jest.fn(),
  quit: jest.fn(),
  disconnect: jest.fn()
}));

jest.mock('../src/repositories/conductorDBRepository');

const redis = require('../src/config/redisClient');
const conductorDBRepository = require('../src/repositories/conductorDBRepository');
const redisRepository = require('../src/repositories/redisRepository');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('redisRepository.obtenerHabilitado (RF 3.1 - cache-aside con TTL)', () => {
  test('en un cache miss consulta la base de datos y guarda el resultado en Redis con TTL', async () => {
    redis.get.mockResolvedValue(null);
    conductorDBRepository.obtenerHabilitadoPorId.mockResolvedValue({
      usuarioID: 'cond_001',
      habilitado: 'activo'
    });

    const resultado = await redisRepository.obtenerHabilitado('cond_001');

    expect(redis.get).toHaveBeenCalledWith('conductor:cond_001:habilitado');
    expect(conductorDBRepository.obtenerHabilitadoPorId).toHaveBeenCalledWith('cond_001');
    expect(redis.set).toHaveBeenCalledWith(
      'conductor:cond_001:habilitado',
      JSON.stringify({ usuarioID: 'cond_001', habilitado: 'activo' }),
      'EX',
      expect.any(Number)
    );
    expect(resultado).toEqual({ usuarioID: 'cond_001', habilitado: 'activo', origen: 'db' });
  });

  test('en un cache hit NO consulta la base de datos', async () => {
    redis.get.mockResolvedValue(JSON.stringify({ usuarioID: 'cond_001', habilitado: 'activo' }));

    const resultado = await redisRepository.obtenerHabilitado('cond_001');

    expect(conductorDBRepository.obtenerHabilitadoPorId).not.toHaveBeenCalled();
    expect(resultado).toEqual({ usuarioID: 'cond_001', habilitado: 'activo', origen: 'cache' });
  });

  test('devuelve null si el conductor no existe ni en caché ni en base de datos', async () => {
    redis.get.mockResolvedValue(null);
    conductorDBRepository.obtenerHabilitadoPorId.mockResolvedValue(null);

    const resultado = await redisRepository.obtenerHabilitado('no_existe');

    expect(resultado).toBeNull();
    expect(redis.set).not.toHaveBeenCalled();
  });
});

describe('redisRepository.obtenerDisponibilidad (RF 3.3 - estado efímero, sin acceso a BD)', () => {
  test('devuelve disponible=true cuando hay un heartbeat vigente en Redis', async () => {
    redis.get.mockResolvedValue(JSON.stringify({ disponible: true }));

    const resultado = await redisRepository.obtenerDisponibilidad('cond_001');

    expect(redis.get).toHaveBeenCalledWith('conductor:cond_001:disponible');
    expect(resultado).toEqual({ usuarioID: 'cond_001', disponible: true });
    expect(conductorDBRepository.obtenerHabilitadoPorId).not.toHaveBeenCalled();
  });

  test('devuelve disponible=false cuando la clave no existe (sin heartbeat o expirada)', async () => {
    redis.get.mockResolvedValue(null);

    const resultado = await redisRepository.obtenerDisponibilidad('cond_002');

    expect(resultado).toEqual({ usuarioID: 'cond_002', disponible: false });
  });
});

describe('redisRepository.actualizarDisponibilidad', () => {
  test('setea la clave efímera en Redis con TTL tipo heartbeat', async () => {
    await redisRepository.actualizarDisponibilidad('cond_001', true);

    expect(redis.set).toHaveBeenCalledWith(
      'conductor:cond_001:disponible',
      JSON.stringify({ usuarioID: 'cond_001', disponible: true }),
      'EX',
      expect.any(Number)
    );
  });
});
