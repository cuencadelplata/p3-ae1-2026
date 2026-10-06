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
  test('consulta el estado previo en Redis con redis.get antes de hacer el set y setea la clave efímera con TTL', async () => {
    redis.get.mockResolvedValue(null);

    const resultado = await redisRepository.actualizarDisponibilidad('cond_001', true);

    // Debe hacer un get previo para conocer el valor anterior
    expect(redis.get).toHaveBeenCalledWith('conductor:cond_001:disponible');
    expect(redis.set).toHaveBeenCalledWith(
      'conductor:cond_001:disponible',
      JSON.stringify({ usuarioID: 'cond_001', disponible: true }),
      'EX',
      expect.any(Number)
    );
    expect(resultado).toEqual({
      usuarioID: 'cond_001',
      disponible: true,
      disponibleAnterior: false
    });
  });

  test('devuelve disponibleAnterior=true cuando ya existía un heartbeat previo en Redis', async () => {
    redis.get.mockResolvedValue(JSON.stringify({ usuarioID: 'cond_001', disponible: true }));

    const resultado = await redisRepository.actualizarDisponibilidad('cond_001', false);

    expect(redis.get).toHaveBeenCalledWith('conductor:cond_001:disponible');
    expect(resultado).toEqual({
      usuarioID: 'cond_001',
      disponible: false,
      disponibleAnterior: true
    });
  });

  test('devuelve disponibleAnterior=false cuando la clave anterior no existía o había expirado por inactividad', async () => {
    // Clave expirada en Redis: redis.get devuelve null
    redis.get.mockResolvedValue(null);

    const resultado = await redisRepository.actualizarDisponibilidad('cond_002', false);

    expect(resultado).toEqual({
      usuarioID: 'cond_002',
      disponible: false,
      disponibleAnterior: false
    });
  });

  test('en caso de fallo en redis.set, usa fallback en memoria sin lanzar excepción', async () => {
    redis.get.mockResolvedValue(null);
    redis.set.mockRejectedValue(new Error('Redis timeout'));

    const resultado = await redisRepository.actualizarDisponibilidad('cond_003', true);

    expect(resultado).toEqual({
      usuarioID: 'cond_003',
      disponible: true,
      disponibleAnterior: false
    });
  });
});

describe('redisRepository.actualizarHabilitado (RF 3.1 - write-through con TTL)', () => {
  test('actualiza en la base de datos y refresca la caché de Redis con TTL', async () => {
    conductorDBRepository.actualizarHabilitado.mockResolvedValue({
      usuarioID: 'cond_001',
      habilitado: 'activo',
      habilitadoAnterior: 'pendiente'
    });

    const resultado = await redisRepository.actualizarHabilitado('cond_001', 'activo');

    expect(conductorDBRepository.actualizarHabilitado).toHaveBeenCalledWith('cond_001', 'activo');
    expect(redis.set).toHaveBeenCalledWith(
      'conductor:cond_001:habilitado',
      JSON.stringify({ usuarioID: 'cond_001', habilitado: 'activo' }),
      'EX',
      expect.any(Number)
    );
    expect(resultado).toEqual({
      usuarioID: 'cond_001',
      habilitado: 'activo',
      habilitadoAnterior: 'pendiente'
    });
  });

  test('devuelve null y no actualiza Redis si el conductor no existe en la base de datos', async () => {
    conductorDBRepository.actualizarHabilitado.mockResolvedValue(null);

    const resultado = await redisRepository.actualizarHabilitado('inexistente', 'activo');

    expect(conductorDBRepository.actualizarHabilitado).toHaveBeenCalledWith('inexistente', 'activo');
    expect(resultado).toBeNull();
    expect(redis.set).not.toHaveBeenCalled();
  });

  test('si falla redis.set al refrescar la caché, no lanza error y retorna el resultado de BD', async () => {
    conductorDBRepository.actualizarHabilitado.mockResolvedValue({
      usuarioID: 'cond_001',
      habilitado: 'suspendido',
      habilitadoAnterior: 'activo'
    });
    redis.set.mockRejectedValue(new Error('Redis write failed'));

    const resultado = await redisRepository.actualizarHabilitado('cond_001', 'suspendido');

    expect(resultado).toEqual({
      usuarioID: 'cond_001',
      habilitado: 'suspendido',
      habilitadoAnterior: 'activo'
    });
  });
});
