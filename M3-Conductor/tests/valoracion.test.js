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
const controllerPath = path.join(SRC, 'controllers', 'valoracionesController.js');

mockModule(redisClientPath, createFakeRedis());

const redisRepository = {
  obtenerValoraciones: createMockFn(),
  registrarValoracion: createMockFn()
};
mockModule(redisRepoPath, redisRepository);

clearModule(controllerPath);
const Valoracion = require('../src/models/Valoracion');
const valoracionesController = require('../src/controllers/valoracionesController');

test.describe('Modelo Valoracion', () => {
  test('debe instanciar correctamente una valoración y exponer sus getters', () => {
    const val = new Valoracion('usr1', 'cond1', 5, 'Excelente servicio');

    expect(val.getUsuarioId()).toBe('usr1');
    expect(val.getConductorId()).toBe('cond1');
    expect(val.getValoracion()).toBe(5);
    expect(val.getComentario()).toBe('Excelente servicio');
  });

  test('debe permitir actualizar propiedades mediante sus setters', () => {
    const val = new Valoracion('usr1', 'cond1', 5, 'Excelente servicio');

    val.setUsuarioId('usr2');
    val.setConductorId('cond2');
    val.setValoracion(4);
    val.setComentario('Buen viaje');

    expect(val.getUsuarioId()).toBe('usr2');
    expect(val.getConductorId()).toBe('cond2');
    expect(val.getValoracion()).toBe(4);
    expect(val.getComentario()).toBe('Buen viaje');
  });
});

test.describe('Controlador Valoraciones (valoracionesController)', () => {
  let req;
  let res;

  test.beforeEach(() => {
    clearAllMocks(...Object.values(redisRepository));
    req = { query: {}, body: {} };
    res = createRes();
  });

  test.describe('obtenerValoraciones', () => {
    test('debe retornar 400 si no se envía usuarioId ni conductorId en query', async () => {
      req.query = {};

      await valoracionesController.obtenerValoraciones(req, res);

      expect(res.status.calls[0][0]).toBe(400);
      expect(res.json.calls[0][0]).toEqual({
        error: "Debe proporcionar el parámetro 'usuarioId' en la query"
      });
    });

    test('debe retornar valoraciones exitosamente con status 200 cuando se envía usuarioId', async () => {
      req.query = { usuarioId: 'cond1' };
      const mockValoraciones = [
        { usuarioId: 'usr1', conductorId: 'cond1', valoracion: 5, comentario: 'Muy bueno' }
      ];
      redisRepository.obtenerValoraciones.mockResolvedValue(mockValoraciones);

      await valoracionesController.obtenerValoraciones(req, res);

      expect(redisRepository.obtenerValoraciones.calls[0][0]).toBe('cond1');
      expect(res.status.calls[0][0]).toBe(200);
      expect(res.json.calls[0][0]).toEqual(mockValoraciones);
    });

    test('debe aceptar conductorId en la query si usuarioId no está presente', async () => {
      req.query = { conductorId: 'cond2' };
      const mockValoraciones = [];
      redisRepository.obtenerValoraciones.mockResolvedValue(mockValoraciones);

      await valoracionesController.obtenerValoraciones(req, res);

      expect(redisRepository.obtenerValoraciones.calls[0][0]).toBe('cond2');
      expect(res.status.calls[0][0]).toBe(200);
      expect(res.json.calls[0][0]).toEqual(mockValoraciones);
    });

    test('debe retornar 500 en caso de falla del repositorio', async () => {
      req.query = { usuarioId: 'cond1' };
      redisRepository.obtenerValoraciones.mockRejectedValue(new Error('Fallo de conexión'));

      await valoracionesController.obtenerValoraciones(req, res);

      expect(res.status.calls[0][0]).toBe(500);
      expect(res.json.calls[0][0]).toEqual({
        error: 'Error al obtener valoraciones desde Redis',
        detalle: 'Fallo de conexión'
      });
    });
  });

  test.describe('crearValoracion', () => {
    test('debe retornar 400 si falta el ID del conductor', async () => {
      req.query = {};
      req.body = { valoracion: 5 };

      await valoracionesController.crearValoracion(req, res);

      expect(res.status.calls[0][0]).toBe(400);
      expect(res.json.calls[0][0]).toEqual({
        error: 'Falta el ID del conductor (usuarioId en query o conductorId en body)'
      });
    });

    test('debe retornar 400 si la valoración no está entre 1 y 5 (ej. menor a 1)', async () => {
      req.query = { usuarioId: 'cond1' };
      req.body = { valoracion: 0 };

      await valoracionesController.crearValoracion(req, res);

      expect(res.status.calls[0][0]).toBe(400);
      expect(res.json.calls[0][0]).toEqual({
        error: 'La valoración debe ser un número entre 1 y 5'
      });
    });

    test('debe retornar 400 si la valoración no está entre 1 y 5 (ej. mayor a 5)', async () => {
      req.query = { usuarioId: 'cond1' };
      req.body = { valoracion: 6 };

      await valoracionesController.crearValoracion(req, res);

      expect(res.status.calls[0][0]).toBe(400);
      expect(res.json.calls[0][0]).toEqual({
        error: 'La valoración debe ser un número entre 1 y 5'
      });
    });

    test('debe registrar una valoración correctamente y asignar pasajero_anonimo si no hay usuarioId', async () => {
      req.query = { usuarioId: 'cond1' };
      req.body = { valoracion: 4, comentario: 'Todo bien' };

      const valoracionGuardada = {
        conductorId: 'cond1',
        usuarioId: 'pasajero_anonimo',
        valoracion: 4,
        comentario: 'Todo bien'
      };

      redisRepository.registrarValoracion.mockResolvedValue(valoracionGuardada);

      await valoracionesController.crearValoracion(req, res);

      expect(redisRepository.registrarValoracion.calls[0][0]).toEqual({
        conductorId: 'cond1',
        usuarioId: 'pasajero_anonimo',
        valoracion: 4,
        comentario: 'Todo bien'
      });
      expect(res.status.calls[0][0]).toBe(201);
      expect(res.json.calls[0][0]).toEqual(valoracionGuardada);
    });

    test('debe registrar una valoración correctamente especificando usuarioId y conductorId en body', async () => {
      req.body = { conductorId: 'cond1', usuarioId: 'usr555', valoracion: 5, comentario: 'Excelente' };

      const valoracionGuardada = {
        conductorId: 'cond1',
        usuarioId: 'usr555',
        valoracion: 5,
        comentario: 'Excelente'
      };

      redisRepository.registrarValoracion.mockResolvedValue(valoracionGuardada);

      await valoracionesController.crearValoracion(req, res);

      expect(redisRepository.registrarValoracion.calls[0][0]).toEqual({
        conductorId: 'cond1',
        usuarioId: 'usr555',
        valoracion: 5,
        comentario: 'Excelente'
      });
      expect(res.status.calls[0][0]).toBe(201);
      expect(res.json.calls[0][0]).toEqual(valoracionGuardada);
    });

    test('debe retornar 400 si el repositorio lanza un error', async () => {
      req.query = { usuarioId: 'cond1' };
      req.body = { valoracion: 5 };
      redisRepository.registrarValoracion.mockRejectedValue(new Error('Error DB'));

      await valoracionesController.crearValoracion(req, res);

      expect(res.status.calls[0][0]).toBe(400);
      expect(res.json.calls[0][0]).toEqual({
        error: 'Solicitud inválida al registrar valoración',
        detalle: 'Error DB'
      });
    });
  });
});
