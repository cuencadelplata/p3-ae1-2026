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

const SRC = path.join(__dirname, '..', 'src');
const redisClientPath = path.join(SRC, 'config', 'redisClient.js');
const redisRepoPath = path.join(SRC, 'repositories', 'redisRepository.js');
const eventPublisherPath = path.join(SRC, 'events', 'eventPublisher.js');
const controllerPath = path.join(SRC, 'controllers', 'conductoresController.js');

mockModule(redisClientPath, createFakeRedis());

const redisRepository = {
  obtenerConductores: createMockFn(),
  obtenerConductorPorId: createMockFn(),
  crearConductor: createMockFn(),
  obtenerHabilitado: createMockFn(),
  obtenerDisponibilidad: createMockFn(),
  actualizarDisponibilidad: createMockFn(),
  actualizarHabilitado: createMockFn()
};
mockModule(redisRepoPath, redisRepository);

const eventPublisher = {
  publicarDriverAvailabilityUpdated: createMockFn(),
  publicarDriverStatusChanged: createMockFn(),
  publicar: createMockFn()
};
mockModule(eventPublisherPath, eventPublisher);

clearModule(controllerPath);
const Conductor = require('../src/models/Conductor');
const conductoresController = require('../src/controllers/conductoresController');

test.describe('Modelo Conductor', () => {
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

test.describe('Controlador Conductores (conductoresController)', () => {
  let req;
  let res;

  test.beforeEach(() => {
    clearAllMocks(
      ...Object.values(redisRepository),
      ...Object.values(eventPublisher)
    );
    req = { params: {}, query: {}, body: {} };
    res = createRes();
  });

  test.describe('obtenerConductores', () => {
    test('debe retornar lista de conductores con status 200', async () => {
      const mockConductores = [
        { usuarioID: 'u1', ciudad: 'Montevideo' },
        { usuarioID: 'u2', ciudad: 'Canelones' }
      ];
      redisRepository.obtenerConductores.mockResolvedValue(mockConductores);

      await conductoresController.obtenerConductores(req, res);

      expect(redisRepository.obtenerConductores.calls.length).toBe(1);
      expect(res.status.calls[0][0]).toBe(200);
      expect(res.json.calls[0][0]).toEqual(mockConductores);
    });

    test('debe retornar error 500 si el repositorio falla', async () => {
      redisRepository.obtenerConductores.mockRejectedValue(new Error('Redis connection error'));

      await conductoresController.obtenerConductores(req, res);

      expect(res.status.calls[0][0]).toBe(500);
      expect(res.json.calls[0][0]).toEqual({
        error: 'Error al obtener conductores desde Redis',
        detalle: 'Redis connection error'
      });
    });
  });

  test.describe('obtenerConductorPorId', () => {
    test('debe retornar 400 si no se proporciona el ID', async () => {
      req.params = {};

      await conductoresController.obtenerConductorPorId(req, res);

      expect(res.status.calls[0][0]).toBe(400);
      expect(res.json.calls[0][0]).toEqual({ error: 'ID de conductor es requerido' });
    });

    test('debe retornar 404 si el conductor no existe', async () => {
      req.params = { id: 'inexistente' };
      redisRepository.obtenerConductorPorId.mockResolvedValue(null);

      await conductoresController.obtenerConductorPorId(req, res);

      expect(redisRepository.obtenerConductorPorId.calls[0][0]).toBe('inexistente');
      expect(res.status.calls[0][0]).toBe(404);
      expect(res.json.calls[0][0]).toEqual({ error: "Conductor con ID 'inexistente' no encontrado" });
    });

    test('debe retornar 200 y el conductor si existe', async () => {
      req.params = { id: 'u123' };
      const mockConductor = { usuarioID: 'u123', ciudad: 'Montevideo' };
      redisRepository.obtenerConductorPorId.mockResolvedValue(mockConductor);

      await conductoresController.obtenerConductorPorId(req, res);

      expect(redisRepository.obtenerConductorPorId.calls[0][0]).toBe('u123');
      expect(res.status.calls[0][0]).toBe(200);
      expect(res.json.calls[0][0]).toEqual(mockConductor);
    });

    test('debe retornar error 500 si falla la consulta', async () => {
      req.params = { id: 'u123' };
      redisRepository.obtenerConductorPorId.mockRejectedValue(new Error('DB error'));

      await conductoresController.obtenerConductorPorId(req, res);

      expect(res.status.calls[0][0]).toBe(500);
      expect(res.json.calls[0][0]).toEqual({
        error: 'Error al obtener conductor desde Redis',
        detalle: 'DB error'
      });
    });
  });

  test.describe('crearConductor', () => {
    test('debe retornar 400 si el body está vacío', async () => {
      req.body = {};

      await conductoresController.crearConductor(req, res);

      expect(res.status.calls[0][0]).toBe(400);
      expect(res.json.calls[0][0]).toEqual({
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

      const llamado = redisRepository.crearConductor.calls[0][0];
      expect(llamado).toMatchObject({
        usuarioID: 'u123',
        ciudad: 'Montevideo',
        tipovehiculo: 'Auto',
        licenciaId: 'lic123',
        vehiculoId: 'veh123',
        habilitado: 'pendiente',
        estado_conexion: 'desconectado'
      });

      expect(res.status.calls[0][0]).toBe(201);
      expect(res.json.calls[0][0]).toEqual(conductorCreadoMock);
    });

    test('debe retornar error 400 si ocurre una excepción en el repositorio', async () => {
      req.body = { usuarioID: 'u123' };
      redisRepository.crearConductor.mockRejectedValue(new Error('Fallo al guardar'));

      await conductoresController.crearConductor(req, res);

      expect(res.status.calls[0][0]).toBe(400);
      expect(res.json.calls[0][0]).toEqual({
        error: 'Solicitud inválida al crear conductor',
        detalle: 'Fallo al guardar'
      });
    });
  });

  test.describe('obtenerHabilitado (RF 3.1)', () => {
    test('debe retornar 400 si no se proporciona el ID', async () => {
      req.params = {};

      await conductoresController.obtenerHabilitado(req, res);

      expect(res.status.calls[0][0]).toBe(400);
      expect(res.json.calls[0][0]).toEqual({ error: 'ID de conductor es requerido' });
    });

    test('debe retornar 404 si el conductor no existe ni en caché ni en base de datos', async () => {
      req.params = { id: 'inexistente' };
      redisRepository.obtenerHabilitado.mockResolvedValue(null);

      await conductoresController.obtenerHabilitado(req, res);

      expect(redisRepository.obtenerHabilitado.calls[0][0]).toBe('inexistente');
      expect(res.status.calls[0][0]).toBe(404);
      expect(res.json.calls[0][0]).toEqual({ error: "Conductor con ID 'inexistente' no encontrado" });
    });

    test('debe retornar 200 con el estado de habilitación desde caché', async () => {
      req.params = { id: 'cond_001' };
      const mockResultado = { usuarioID: 'cond_001', habilitado: 'activo', origen: 'cache' };
      redisRepository.obtenerHabilitado.mockResolvedValue(mockResultado);

      await conductoresController.obtenerHabilitado(req, res);

      expect(res.status.calls[0][0]).toBe(200);
      expect(res.json.calls[0][0]).toEqual(mockResultado);
    });

    test('debe retornar 200 con el estado de habilitación recargado desde la base de datos', async () => {
      req.params = { id: 'cond_002' };
      const mockResultado = { usuarioID: 'cond_002', habilitado: 'pendiente', origen: 'db' };
      redisRepository.obtenerHabilitado.mockResolvedValue(mockResultado);

      await conductoresController.obtenerHabilitado(req, res);

      expect(res.status.calls[0][0]).toBe(200);
      expect(res.json.calls[0][0]).toEqual(mockResultado);
    });

    test('debe retornar error 500 si el repositorio falla', async () => {
      req.params = { id: 'cond_001' };
      redisRepository.obtenerHabilitado.mockRejectedValue(new Error('Redis connection error'));

      await conductoresController.obtenerHabilitado(req, res);

      expect(res.status.calls[0][0]).toBe(500);
      expect(res.json.calls[0][0]).toEqual({
        error: 'Error al obtener habilitación del conductor',
        detalle: 'Redis connection error'
      });
    });
  });

  test.describe('obtenerDisponible (RF 3.3)', () => {
    test('debe retornar 400 si no se proporciona el ID', async () => {
      req.params = {};

      await conductoresController.obtenerDisponible(req, res);

      expect(res.status.calls[0][0]).toBe(400);
      expect(res.json.calls[0][0]).toEqual({ error: 'ID de conductor es requerido' });
    });

    test('debe retornar 200 con disponible=true cuando hay un heartbeat vigente en Redis', async () => {
      req.params = { id: 'cond_001' };
      const mockResultado = { usuarioID: 'cond_001', disponible: true };
      redisRepository.obtenerDisponibilidad.mockResolvedValue(mockResultado);

      await conductoresController.obtenerDisponible(req, res);

      expect(redisRepository.obtenerDisponibilidad.calls[0][0]).toBe('cond_001');
      expect(res.status.calls[0][0]).toBe(200);
      expect(res.json.calls[0][0]).toEqual(mockResultado);
    });

    test('debe retornar 200 con disponible=false cuando no hay heartbeat y no emitir evento', async () => {
      req.params = { id: 'cond_002' };
      const mockResultado = { usuarioID: 'cond_002', disponible: false };
      redisRepository.obtenerDisponibilidad.mockResolvedValue(mockResultado);

      await conductoresController.obtenerDisponible(req, res);

      expect(res.status.calls[0][0]).toBe(200);
      expect(res.json.calls[0][0]).toEqual(mockResultado);
      expect(eventPublisher.publicarDriverAvailabilityUpdated.calls.length).toBe(0);
    });

    test('debe retornar error 500 si el repositorio falla', async () => {
      req.params = { id: 'cond_001' };
      redisRepository.obtenerDisponibilidad.mockRejectedValue(new Error('Redis connection error'));

      await conductoresController.obtenerDisponible(req, res);

      expect(res.status.calls[0][0]).toBe(500);
      expect(res.json.calls[0][0]).toEqual({
        error: 'Error al obtener disponibilidad del conductor',
        detalle: 'Redis connection error'
      });
    });
  });

  test.describe('actualizarDisponible (RF 3.3 / RNF-07)', () => {
    test('debe retornar 400 si el campo disponible no es booleano', async () => {
      req.params = { id: 'cond_001' };
      req.body = { disponible: 'si' };

      await conductoresController.actualizarDisponible(req, res);

      expect(res.status.calls[0][0]).toBe(400);
      expect(res.json.calls[0][0]).toEqual({
        error: "El campo 'disponible' es requerido y debe ser booleano"
      });
      expect(eventPublisher.publicarDriverAvailabilityUpdated.calls.length).toBe(0);
    });

    test('debe retornar 400 si el body no incluye disponible', async () => {
      req.params = { id: 'cond_001' };
      req.body = {};

      await conductoresController.actualizarDisponible(req, res);

      expect(res.status.calls[0][0]).toBe(400);
      expect(res.json.calls[0][0]).toEqual({
        error: "El campo 'disponible' es requerido y debe ser booleano"
      });
    });

    test('debe retornar 200 y emitir DriverAvailabilityUpdated cuando la disponibilidad cambia', async () => {
      req.params = { id: 'cond_001' };
      req.body = { disponible: true };
      const mockResultado = { usuarioID: 'cond_001', disponible: true, disponibleAnterior: false };
      redisRepository.actualizarDisponibilidad.mockResolvedValue(mockResultado);

      await conductoresController.actualizarDisponible(req, res);

      expect(redisRepository.actualizarDisponibilidad.calls[0]).toEqual(['cond_001', true]);
      expect(eventPublisher.publicarDriverAvailabilityUpdated.calls[0][0]).toEqual(mockResultado);
      expect(res.status.calls[0][0]).toBe(200);
      expect(res.json.calls[0][0]).toEqual({ ...mockResultado, eventoEmitido: true });
    });

    test('debe retornar 200 y NO emitir evento cuando la disponibilidad no cambia', async () => {
      req.params = { id: 'cond_001' };
      req.body = { disponible: true };
      const mockResultado = { usuarioID: 'cond_001', disponible: true, disponibleAnterior: true };
      redisRepository.actualizarDisponibilidad.mockResolvedValue(mockResultado);

      await conductoresController.actualizarDisponible(req, res);

      expect(redisRepository.actualizarDisponibilidad.calls[0]).toEqual(['cond_001', true]);
      expect(eventPublisher.publicarDriverAvailabilityUpdated.calls.length).toBe(0);
      expect(res.status.calls[0][0]).toBe(200);
      expect(res.json.calls[0][0]).toEqual({ ...mockResultado, eventoEmitido: false });
    });

    test('debe retornar 200 y NO emitir evento si la clave expiró y se reporta disponible=false', async () => {
      req.params = { id: 'cond_001' };
      req.body = { disponible: false };
      const mockResultado = { usuarioID: 'cond_001', disponible: false, disponibleAnterior: false };
      redisRepository.actualizarDisponibilidad.mockResolvedValue(mockResultado);

      await conductoresController.actualizarDisponible(req, res);

      expect(redisRepository.actualizarDisponibilidad.calls[0]).toEqual(['cond_001', false]);
      expect(eventPublisher.publicarDriverAvailabilityUpdated.calls.length).toBe(0);
      expect(res.status.calls[0][0]).toBe(200);
      expect(res.json.calls[0][0]).toEqual({ ...mockResultado, eventoEmitido: false });
    });

    test('debe retornar error 500 si el repositorio falla', async () => {
      req.params = { id: 'cond_001' };
      req.body = { disponible: true };
      redisRepository.actualizarDisponibilidad.mockRejectedValue(new Error('Redis connection failed'));

      await conductoresController.actualizarDisponible(req, res);

      expect(res.status.calls[0][0]).toBe(500);
      expect(res.json.calls[0][0]).toEqual({
        error: 'Error al actualizar disponibilidad del conductor',
        detalle: 'Redis connection failed'
      });
      expect(eventPublisher.publicarDriverAvailabilityUpdated.calls.length).toBe(0);
    });
  });

  test.describe('actualizarHabilitado (RF 3.1 / RNF-07)', () => {
    test('debe retornar 400 si el campo habilitado no es un estado válido', async () => {
      req.params = { id: 'cond_001' };
      req.body = { habilitado: 'invalido' };

      await conductoresController.actualizarHabilitado(req, res);

      expect(res.status.calls[0][0]).toBe(400);
      expect(res.json.calls[0][0]).toEqual({
        error: "El campo 'habilitado' debe ser uno de: pendiente, activo, suspendido, rechazado"
      });
      expect(eventPublisher.publicarDriverStatusChanged.calls.length).toBe(0);
    });

    test('debe retornar 404 si el conductor no existe en la base de datos', async () => {
      req.params = { id: 'inexistente' };
      req.body = { habilitado: 'activo' };
      redisRepository.actualizarHabilitado.mockResolvedValue(null);

      await conductoresController.actualizarHabilitado(req, res);

      expect(redisRepository.actualizarHabilitado.calls[0]).toEqual(['inexistente', 'activo']);
      expect(res.status.calls[0][0]).toBe(404);
      expect(res.json.calls[0][0]).toEqual({
        error: "Conductor con ID 'inexistente' no encontrado"
      });
      expect(eventPublisher.publicarDriverStatusChanged.calls.length).toBe(0);
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

      expect(redisRepository.actualizarHabilitado.calls[0]).toEqual(['cond_001', 'activo']);
      expect(eventPublisher.publicarDriverStatusChanged.calls[0][0]).toEqual({
        ...mockResultado,
        motivo: 'Documentación aprobada'
      });
      expect(res.status.calls[0][0]).toBe(200);
      expect(res.json.calls[0][0]).toEqual({ ...mockResultado, eventoEmitido: true });
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

      expect(redisRepository.actualizarHabilitado.calls[0]).toEqual(['cond_001', 'activo']);
      expect(eventPublisher.publicarDriverStatusChanged.calls.length).toBe(0);
      expect(res.status.calls[0][0]).toBe(200);
      expect(res.json.calls[0][0]).toEqual({ ...mockResultado, eventoEmitido: false });
    });

    test('debe retornar error 500 si el repositorio falla', async () => {
      req.params = { id: 'cond_001' };
      req.body = { habilitado: 'suspendido' };
      redisRepository.actualizarHabilitado.mockRejectedValue(new Error('DB failure'));

      await conductoresController.actualizarHabilitado(req, res);

      expect(res.status.calls[0][0]).toBe(500);
      expect(res.json.calls[0][0]).toEqual({
        error: 'Error al actualizar habilitación del conductor',
        detalle: 'DB failure'
      });
      expect(eventPublisher.publicarDriverStatusChanged.calls.length).toBe(0);
    });
  });

  test.describe('obtenerEstadoConductor / habilitado / disponible', () => {
    test('debe retornar 404 si el conductor no existe', async () => {
      req.params = { id: 'no_existe' };
      redisRepository.obtenerConductorPorId.mockResolvedValue(null);

      await conductoresController.obtenerEstadoConductor(req, res);

      expect(res.status.calls[0][0]).toBe(404);
      expect(res.json.calls[0][0]).toEqual({ error: "Conductor con ID 'no_existe' no encontrado" });
    });

    test('debe retornar el estado con habilitado=true y disponible=true si cumple las condiciones', async () => {
      req.params = { id: 'u123' };
      const conductorMock = {
        usuarioID: 'u123',
        habilitado: 'activo',
        estado_conexion: 'conectado'
      };
      redisRepository.obtenerConductorPorId.mockResolvedValue(conductorMock);

      await conductoresController.obtenerEstadoConductor(req, res);

      expect(res.status.calls[0][0]).toBe(200);
      expect(res.json.calls[0][0]).toEqual({
        usuarioID: 'u123',
        habilitado: true,
        disponible: true,
        estado: 'activo',
        estado_conexion: 'conectado'
      });
    });

    test('debe retornar disponible=false si está desconectado', async () => {
      req.params = { id: 'u123' };
      const conductorMock = {
        usuarioID: 'u123',
        habilitado: 'activo',
        estado_conexion: 'desconectado'
      };
      redisRepository.obtenerConductorPorId.mockResolvedValue(conductorMock);

      await conductoresController.obtenerDisponibleConductor(req, res);

      expect(res.status.calls[0][0]).toBe(200);
      expect(res.json.calls[0][0]).toEqual({
        usuarioID: 'u123',
        habilitado: true,
        disponible: false,
        estado: 'activo',
        estado_conexion: 'desconectado'
      });
    });
  });
});
