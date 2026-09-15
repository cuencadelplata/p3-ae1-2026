const Conductor = require('../src/models/Conductor');
const conductoresController = require('../src/controllers/conductoresController');
const redisRepository = require('../src/repositories/redisRepository');

// Mock del cliente redis para evitar sockets/conexiones colgadas en background
jest.mock('../src/config/redisClient', () => ({
  on: jest.fn(),
  quit: jest.fn(),
  disconnect: jest.fn()
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
});
