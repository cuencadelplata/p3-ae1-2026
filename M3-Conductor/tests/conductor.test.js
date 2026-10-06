const Conductor = require('../src/models/Conductor');
const conductoresController = require('../src/controllers/conductoresController');
const redisRepository = require('../src/repositories/redisRepository');
const eventPublisher = require('../src/events/eventPublisher');

// Mock del cliente redis para evitar sockets/conexiones colgadas en background
jest.mock('../src/config/redisClient', () => ({
  on: jest.fn(),
  quit: jest.fn(),
  disconnect: jest.fn()
}));

// Mock del publicador de eventos para evitar conexiones a RabbitMQ
jest.mock('../src/events/eventPublisher', () => ({
  publicarDriverAvailabilityUpdated: jest.fn(),
  publicarDriverStatusChanged: jest.fn(),
  publicar: jest.fn()
}));

// Mock del repositorio de redis
jest.mock('../src/repositories/redisRepository');

describe('Modelo Conductor', () => {
  test('debe instanciar correctamente un conductor con valores iniciales por defecto', () => {
    const conductor = new Conductor('u123', 'Montevideo', 'Auto', 'lic456', 'veh789');

    expect(conductor.getusuarioID()).toBe('u123');
    expect(conductor.getciudad()).toBe('Montevideo');
    expect(conductor.gettipovehiculo()).toBe('Auto');
    expect(conductor.getlicenciaId()).toBe('lic456');
    expect(conductor.getvehiculoId()).toBe('veh789');
    expect(conductor.gethabilitado()).toBe('pendiente');
    expect(conductor.getestado_conexion()).toBe('desconectado');
  });

  test('debe permitir modificar las propiedades usando los setters', () => {
    const conductor = new Conductor('u123', 'Montevideo', 'Auto', 'lic456', 'veh789');

    conductor.setusuarioID('u999');
    conductor.setciudad('Maldonado');
    conductor.settipovehiculo('Moto');
    conductor.setlicenciaId('lic999');
    conductor.setvehiculoId('veh999');
    conductor.sethabilitado('aprobado');
    conductor.setestado_conexion('conectado');

    expect(conductor.getusuarioID()).toBe('u999');
    expect(conductor.getciudad()).toBe('Maldonado');
    expect(conductor.gettipovehiculo()).toBe('Moto');
    expect(conductor.getlicenciaId()).toBe('lic999');
    expect(conductor.getvehiculoId()).toBe('veh999');
    expect(conductor.gethabilitado()).toBe('aprobado');
    expect(conductor.getestado_conexion()).toBe('conectado');
  });
});

describe('Controlador Conductores (conductoresController)', () => {
  let req, res;

  beforeEach(() => {
    jest.clearAllMocks();
    req = {
      params: {},
      query: {},
      body: {}
    };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis()
    };
  });

  describe('obtenerConductores', () => {
    test('debe retornar lista de conductores con status 200', async () => {
      const mockConductores = [
        { usuarioID: 'u1', ciudad: 'Montevideo' },
        { usuarioID: 'u2', ciudad: 'Canelones' }
      ];
      redisRepository.obtenerConductores.mockResolvedValue(mockConductores);

      await conductoresController.obtenerConductores(req, res);

      expect(redisRepository.obtenerConductores).toHaveBeenCalledTimes(1);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(mockConductores);
    });

    test('debe retornar error 500 si el repositorio falla', async () => {
      redisRepository.obtenerConductores.mockRejectedValue(new Error('Redis connection error'));

      await conductoresController.obtenerConductores(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Error al obtener conductores desde Redis',
        detalle: 'Redis connection error'
      });
    });
  });

  describe('obtenerConductorPorId', () => {
    test('debe retornar 400 si no se proporciona el ID', async () => {
      req.params = {};

      await conductoresController.obtenerConductorPorId(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: 'ID de conductor es requerido' });
    });

    test('debe retornar 404 si el conductor no existe', async () => {
      req.params = { id: 'inexistente' };
      redisRepository.obtenerConductorPorId.mockResolvedValue(null);

      await conductoresController.obtenerConductorPorId(req, res);

      expect(redisRepository.obtenerConductorPorId).toHaveBeenCalledWith('inexistente');
      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ error: "Conductor con ID 'inexistente' no encontrado" });
    });

    test('debe retornar 200 y el conductor si existe', async () => {
      req.params = { id: 'u123' };
      const mockConductor = { usuarioID: 'u123', ciudad: 'Montevideo' };
      redisRepository.obtenerConductorPorId.mockResolvedValue(mockConductor);

      await conductoresController.obtenerConductorPorId(req, res);

      expect(redisRepository.obtenerConductorPorId).toHaveBeenCalledWith('u123');
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(mockConductor);
    });

    test('debe retornar error 500 si falla la consulta', async () => {
      req.params = { id: 'u123' };
      redisRepository.obtenerConductorPorId.mockRejectedValue(new Error('DB error'));

      await conductoresController.obtenerConductorPorId(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Error al obtener conductor desde Redis',
        detalle: 'DB error'
      });
    });
  });

  describe('crearConductor', () => {
    test('debe retornar 400 si el body está vacío', async () => {
      req.body = {};

      await conductoresController.crearConductor(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Solicitud inválida: El cuerpo no puede estar vacío'
      });
    });

    test('debe crear un conductor exitosamente y retornar 201', async () => {
      req.body = {
        usuarioID: 'u123',
        ciudad: 'Montevideo',
        tipovehiculo: 'Auto',
        licenciaId: 'lic123',
        vehiculoId: 'veh123'
      };

      const conductorCreadoMock = {
        ...req.body,
        habilitado: 'pendiente',
        estado_conexion: 'desconectado'
      };

      redisRepository.crearConductor.mockResolvedValue(conductorCreadoMock);

      await conductoresController.crearConductor(req, res);

      expect(redisRepository.crearConductor).toHaveBeenCalledWith(expect.objectContaining({
        usuarioID: 'u123',
        ciudad: 'Montevideo',
        tipovehiculo: 'Auto',
        licenciaId: 'lic123',
        vehiculoId: 'veh123',
        habilitado: 'pendiente',
        estado_conexion: 'desconectado'
      }));

      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith(conductorCreadoMock);
    });

    test('debe retornar error 400 si ocurre una excepción en el repositorio', async () => {
      req.body = { usuarioID: 'u123' };
      redisRepository.crearConductor.mockRejectedValue(new Error('Fallo al guardar'));

      await conductoresController.crearConductor(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Solicitud inválida al crear conductor',
        detalle: 'Fallo al guardar'
      });
    });
  });

  describe('obtenerHabilitado (RF 3.1)', () => {
    test('debe retornar 400 si no se proporciona el ID', async () => {
      req.params = {};

      await conductoresController.obtenerHabilitado(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: 'ID de conductor es requerido' });
    });

    test('debe retornar 404 si el conductor no existe ni en caché ni en base de datos', async () => {
      req.params = { id: 'inexistente' };
      redisRepository.obtenerHabilitado.mockResolvedValue(null);

      await conductoresController.obtenerHabilitado(req, res);

      expect(redisRepository.obtenerHabilitado).toHaveBeenCalledWith('inexistente');
      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ error: "Conductor con ID 'inexistente' no encontrado" });
    });

    test('debe retornar 200 con el estado de habilitación desde caché', async () => {
      req.params = { id: 'cond_001' };
      const mockResultado = { usuarioID: 'cond_001', habilitado: 'activo', origen: 'cache' };
      redisRepository.obtenerHabilitado.mockResolvedValue(mockResultado);

      await conductoresController.obtenerHabilitado(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(mockResultado);
    });

    test('debe retornar 200 con el estado de habilitación recargado desde la base de datos', async () => {
      req.params = { id: 'cond_002' };
      const mockResultado = { usuarioID: 'cond_002', habilitado: 'pendiente', origen: 'db' };
      redisRepository.obtenerHabilitado.mockResolvedValue(mockResultado);

      await conductoresController.obtenerHabilitado(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(mockResultado);
    });

    test('debe retornar error 500 si el repositorio falla', async () => {
      req.params = { id: 'cond_001' };
      redisRepository.obtenerHabilitado.mockRejectedValue(new Error('Redis connection error'));

      await conductoresController.obtenerHabilitado(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Error al obtener habilitación del conductor',
        detalle: 'Redis connection error'
      });
    });
  });

  describe('obtenerDisponible (RF 3.3)', () => {
    test('debe retornar 400 si no se proporciona el ID', async () => {
      req.params = {};

      await conductoresController.obtenerDisponible(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: 'ID de conductor es requerido' });
    });

    test('debe retornar 200 con disponible=true cuando hay un heartbeat vigente en Redis', async () => {
      req.params = { id: 'cond_001' };
      const mockResultado = { usuarioID: 'cond_001', disponible: true };
      redisRepository.obtenerDisponibilidad.mockResolvedValue(mockResultado);

      await conductoresController.obtenerDisponible(req, res);

      expect(redisRepository.obtenerDisponibilidad).toHaveBeenCalledWith('cond_001');
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(mockResultado);
    });

    test('debe retornar 200 con disponible=false cuando no hay heartbeat (clave expirada o inexistente) y no emitir evento', async () => {
      req.params = { id: 'cond_002' };
      const mockResultado = { usuarioID: 'cond_002', disponible: false };
      redisRepository.obtenerDisponibilidad.mockResolvedValue(mockResultado);

      await conductoresController.obtenerDisponible(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(mockResultado);
      // Expiración pasiva en Redis: no notifica al broker
      expect(eventPublisher.publicarDriverAvailabilityUpdated).not.toHaveBeenCalled();
    });

    test('debe retornar error 500 si el repositorio falla', async () => {
      req.params = { id: 'cond_001' };
      redisRepository.obtenerDisponibilidad.mockRejectedValue(new Error('Redis connection error'));

      await conductoresController.obtenerDisponible(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Error al obtener disponibilidad del conductor',
        detalle: 'Redis connection error'
      });
    });
  });

  describe('actualizarDisponible (RF 3.3 / RNF-07)', () => {
    test('debe retornar 400 si el campo disponible no es booleano', async () => {
      req.params = { id: 'cond_001' };
      req.body = { disponible: 'si' };

      await conductoresController.actualizarDisponible(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: "El campo 'disponible' es requerido y debe ser booleano"
      });
      expect(eventPublisher.publicarDriverAvailabilityUpdated).not.toHaveBeenCalled();
    });

    test('debe retornar 400 si el body no incluye disponible', async () => {
      req.params = { id: 'cond_001' };
      req.body = {};

      await conductoresController.actualizarDisponible(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: "El campo 'disponible' es requerido y debe ser booleano"
      });
    });

    test('debe retornar 200 y emitir DriverAvailabilityUpdated cuando la disponibilidad cambia (false -> true)', async () => {
      req.params = { id: 'cond_001' };
      req.body = { disponible: true };
      const mockResultado = { usuarioID: 'cond_001', disponible: true, disponibleAnterior: false };
      redisRepository.actualizarDisponibilidad.mockResolvedValue(mockResultado);

      await conductoresController.actualizarDisponible(req, res);

      expect(redisRepository.actualizarDisponibilidad).toHaveBeenCalledWith('cond_001', true);
      expect(eventPublisher.publicarDriverAvailabilityUpdated).toHaveBeenCalledWith(mockResultado);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ ...mockResultado, eventoEmitido: true });
    });

    test('debe retornar 200 y NO emitir evento cuando la disponibilidad no cambia (heartbeat true -> true)', async () => {
      req.params = { id: 'cond_001' };
      req.body = { disponible: true };
      const mockResultado = { usuarioID: 'cond_001', disponible: true, disponibleAnterior: true };
      redisRepository.actualizarDisponibilidad.mockResolvedValue(mockResultado);

      await conductoresController.actualizarDisponible(req, res);

      expect(redisRepository.actualizarDisponibilidad).toHaveBeenCalledWith('cond_001', true);
      expect(eventPublisher.publicarDriverAvailabilityUpdated).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ ...mockResultado, eventoEmitido: false });
    });

    test('debe retornar 200 y NO emitir evento si la clave expiró por inactividad y se reporta disponible=false (false -> false)', async () => {
      // Clave expirada en Redis = disponibleAnterior: false. Si se manda disponible: false, no hay cambio.
      req.params = { id: 'cond_001' };
      req.body = { disponible: false };
      const mockResultado = { usuarioID: 'cond_001', disponible: false, disponibleAnterior: false };
      redisRepository.actualizarDisponibilidad.mockResolvedValue(mockResultado);

      await conductoresController.actualizarDisponible(req, res);

      expect(redisRepository.actualizarDisponibilidad).toHaveBeenCalledWith('cond_001', false);
      expect(eventPublisher.publicarDriverAvailabilityUpdated).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ ...mockResultado, eventoEmitido: false });
    });

    test('debe retornar error 500 si el repositorio falla', async () => {
      req.params = { id: 'cond_001' };
      req.body = { disponible: true };
      redisRepository.actualizarDisponibilidad.mockRejectedValue(new Error('Redis connection failed'));

      await conductoresController.actualizarDisponible(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Error al actualizar disponibilidad del conductor',
        detalle: 'Redis connection failed'
      });
      expect(eventPublisher.publicarDriverAvailabilityUpdated).not.toHaveBeenCalled();
    });
  });

  describe('actualizarHabilitado (RF 3.1 / RNF-07)', () => {
    test('debe retornar 400 si el campo habilitado no es un estado válido', async () => {
      req.params = { id: 'cond_001' };
      req.body = { habilitado: 'invalido' };

      await conductoresController.actualizarHabilitado(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: "El campo 'habilitado' debe ser uno de: pendiente, activo, suspendido, rechazado"
      });
      expect(eventPublisher.publicarDriverStatusChanged).not.toHaveBeenCalled();
    });

    test('debe retornar 404 si el conductor no existe en la base de datos', async () => {
      req.params = { id: 'inexistente' };
      req.body = { habilitado: 'activo' };
      redisRepository.actualizarHabilitado.mockResolvedValue(null);

      await conductoresController.actualizarHabilitado(req, res);

      expect(redisRepository.actualizarHabilitado).toHaveBeenCalledWith('inexistente', 'activo');
      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({
        error: "Conductor con ID 'inexistente' no encontrado"
      });
      expect(eventPublisher.publicarDriverStatusChanged).not.toHaveBeenCalled();
    });

    test('debe retornar 200 y emitir DriverStatusChanged cuando el estado cambia', async () => {
      req.params = { id: 'cond_001' };
      req.body = { habilitado: 'activo', motivo: 'Documentación aprobada' };
      const mockResultado = {
        usuarioID: 'cond_001',
        habilitado: 'activo',
        habilitadoAnterior: 'pendiente'
      };
      redisRepository.actualizarHabilitado.mockResolvedValue(mockResultado);

      await conductoresController.actualizarHabilitado(req, res);

      expect(redisRepository.actualizarHabilitado).toHaveBeenCalledWith('cond_001', 'activo');
      expect(eventPublisher.publicarDriverStatusChanged).toHaveBeenCalledWith({
        ...mockResultado,
        motivo: 'Documentación aprobada'
      });
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ ...mockResultado, eventoEmitido: true });
    });

    test('debe retornar 200 y NO emitir evento si el estado no cambia', async () => {
      req.params = { id: 'cond_001' };
      req.body = { habilitado: 'activo' };
      const mockResultado = {
        usuarioID: 'cond_001',
        habilitado: 'activo',
        habilitadoAnterior: 'activo'
      };
      redisRepository.actualizarHabilitado.mockResolvedValue(mockResultado);

      await conductoresController.actualizarHabilitado(req, res);

      expect(redisRepository.actualizarHabilitado).toHaveBeenCalledWith('cond_001', 'activo');
      expect(eventPublisher.publicarDriverStatusChanged).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ ...mockResultado, eventoEmitido: false });
    });

    test('debe retornar error 500 si el repositorio falla', async () => {
      req.params = { id: 'cond_001' };
      req.body = { habilitado: 'suspendido' };
      redisRepository.actualizarHabilitado.mockRejectedValue(new Error('DB failure'));

      await conductoresController.actualizarHabilitado(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Error al actualizar habilitación del conductor',
        detalle: 'DB failure'
      });
      expect(eventPublisher.publicarDriverStatusChanged).not.toHaveBeenCalled();
    });
  });
});
