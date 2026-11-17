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
const publisherPath = path.join(
  SRC,
  'modules',
  'valoraciones',
  'ValoracionRegistrada.publisher.js'
);
const controllerPath = path.join(SRC, 'controllers', 'valoracionesController.js');

mockModule(redisClientPath, createFakeRedis());

const redisRepository = {
  obtenerValoraciones: createMockFn(),
  registrarValoracion: createMockFn()
};
mockModule(redisRepoPath, redisRepository);

const valoracionRegistradaPublisher = {
  publicarValoracionRegistrada: createMockFn()
};
mockModule(publisherPath, valoracionRegistradaPublisher);

clearModule(controllerPath);
const Valoracion = require('../src/models/Valoracion');
const valoracionesController = require('../src/controllers/valoracionesController');

test.describe('Modelo Valoracion', () => {
  test('debe instanciar con evaluador (conductor) y evaluado (pasajero)', () => {
    const val = new Valoracion('cond1', 'pasajero1', 5, 'Pasajero puntual');

    expect(val.getEvaluadorId()).toBe('cond1');
    expect(val.getEvaluadoId()).toBe('pasajero1');
    expect(val.getValoracion()).toBe(5);
    expect(val.getComentario()).toBe('Pasajero puntual');
  });

  test('debe permitir actualizar propiedades mediante sus setters', () => {
    const val = new Valoracion('cond1', 'pasajero1', 5, 'Pasajero puntual');

    val.setEvaluadorId('cond2');
    val.setEvaluadoId('pasajero2');
    val.setValoracion(4);
    val.setComentario('Buen viaje');

    expect(val.getEvaluadorId()).toBe('cond2');
    expect(val.getEvaluadoId()).toBe('pasajero2');
    expect(val.getValoracion()).toBe(4);
    expect(val.getComentario()).toBe('Buen viaje');
  });
});

test.describe('Controlador Valoraciones (valoracionesController)', () => {
  let req;
  let res;

  test.beforeEach(() => {
    clearAllMocks(
      ...Object.values(redisRepository),
      ...Object.values(valoracionRegistradaPublisher)
    );
    valoracionRegistradaPublisher.publicarValoracionRegistrada.mockResolvedValue(true);
    req = { query: {}, body: {} };
    res = createRes();
  });

  test.describe('obtenerValoraciones', () => {
    test('debe retornar 400 si no se envía evaluadorId ni conductorId en query', async () => {
      req.query = {};

      await valoracionesController.obtenerValoraciones(req, res);

      expect(res.status.calls[0][0]).toBe(400);
      expect(res.json.calls[0][0]).toEqual({
        error: "Debe proporcionar el parámetro 'evaluadorId' o 'conductorId' en la query"
      });
    });

    test('debe retornar valoraciones con status 200 cuando se envía evaluadorId', async () => {
      req.query = { evaluadorId: 'cond1' };
      const mockValoraciones = [
        { evaluadorId: 'cond1', evaluadoId: 'pasajero1', valoracion: 5, comentario: 'Muy bueno' }
      ];
      redisRepository.obtenerValoraciones.mockResolvedValue(mockValoraciones);

      await valoracionesController.obtenerValoraciones(req, res);

      expect(redisRepository.obtenerValoraciones.calls[0][0]).toBe('cond1');
      expect(res.status.calls[0][0]).toBe(200);
      expect(res.json.calls[0][0]).toEqual(mockValoraciones);
    });

    test('debe aceptar conductorId en la query como alias de evaluadorId', async () => {
      req.query = { conductorId: 'cond2' };
      const mockValoraciones = [];
      redisRepository.obtenerValoraciones.mockResolvedValue(mockValoraciones);

      await valoracionesController.obtenerValoraciones(req, res);

      expect(redisRepository.obtenerValoraciones.calls[0][0]).toBe('cond2');
      expect(res.status.calls[0][0]).toBe(200);
      expect(res.json.calls[0][0]).toEqual(mockValoraciones);
    });

    test('no debe tratar usuarioId en query como conductor', async () => {
      req.query = { usuarioId: 'cond1' };

      await valoracionesController.obtenerValoraciones(req, res);

      expect(res.status.calls[0][0]).toBe(400);
    });

    test('debe retornar 500 en caso de falla del repositorio', async () => {
      req.query = { evaluadorId: 'cond1' };
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
    test('debe retornar 400 si falta el ID del evaluador', async () => {
      req.query = {};
      req.body = { evaluadoId: 'pasajero1', valoracion: 5 };

      await valoracionesController.crearValoracion(req, res);

      expect(res.status.calls[0][0]).toBe(400);
      expect(res.json.calls[0][0]).toEqual({
        error: 'Falta el ID del evaluador (evaluadorId o conductorId en query/body)'
      });
    });

    test('debe retornar 400 si falta el ID del pasajero evaluado', async () => {
      req.body = { evaluadorId: 'cond1', valoracion: 5 };

      await valoracionesController.crearValoracion(req, res);

      expect(res.status.calls[0][0]).toBe(400);
      expect(res.json.calls[0][0]).toEqual({
        error: 'Falta el ID del pasajero evaluado (evaluadoId, clienteId o usuarioId en body)'
      });
    });

    test('debe retornar 400 si la valoración no está entre 1 y 5 (ej. menor a 1)', async () => {
      req.body = { evaluadorId: 'cond1', evaluadoId: 'pasajero1', valoracion: 0 };

      await valoracionesController.crearValoracion(req, res);

      expect(res.status.calls[0][0]).toBe(400);
      expect(res.json.calls[0][0]).toEqual({
        error: 'La valoración debe ser un número entre 1 y 5'
      });
    });

    test('debe retornar 400 si la valoración no está entre 1 y 5 (ej. mayor a 5)', async () => {
      req.body = { evaluadorId: 'cond1', evaluadoId: 'pasajero1', valoracion: 6 };

      await valoracionesController.crearValoracion(req, res);

      expect(res.status.calls[0][0]).toBe(400);
      expect(res.json.calls[0][0]).toEqual({
        error: 'La valoración debe ser un número entre 1 y 5'
      });
    });

    test('debe registrar valoración conductor→pasajero con evaluadorId y evaluadoId', async () => {
      req.body = {
        evaluadorId: 'cond1',
        evaluadoId: 'pasajero1',
        valoracion: 4,
        comentario: 'Todo bien',
        viajeId: 'viaje-1'
      };

      const valoracionGuardada = {
        evaluadorId: 'cond1',
        evaluadoId: 'pasajero1',
        valoracion: 4,
        comentario: 'Todo bien',
        viajeId: 'viaje-1'
      };

      redisRepository.registrarValoracion.mockResolvedValue(valoracionGuardada);

      await valoracionesController.crearValoracion(req, res);

      expect(redisRepository.registrarValoracion.calls[0][0]).toEqual({
        evaluadorId: 'cond1',
        evaluadoId: 'pasajero1',
        valoracion: 4,
        comentario: 'Todo bien',
        viajeId: 'viaje-1'
      });
      expect(
        valoracionRegistradaPublisher.publicarValoracionRegistrada.calls[0][0]
      ).toEqual(valoracionGuardada);
      expect(res.status.calls[0][0]).toBe(201);
      expect(res.json.calls[0][0]).toEqual({
        ...valoracionGuardada,
        eventoEmitido: true
      });
    });

    test('debe aceptar aliases conductorId y clienteId/usuarioId', async () => {
      req.body = {
        conductorId: 'cond1',
        usuarioId: 'pasajero555',
        valoracion: 5,
        comentario: 'Excelente'
      };

      const valoracionGuardada = {
        evaluadorId: 'cond1',
        evaluadoId: 'pasajero555',
        valoracion: 5,
        comentario: 'Excelente',
        viajeId: null
      };

      redisRepository.registrarValoracion.mockResolvedValue(valoracionGuardada);

      await valoracionesController.crearValoracion(req, res);

      expect(redisRepository.registrarValoracion.calls[0][0]).toEqual({
        evaluadorId: 'cond1',
        evaluadoId: 'pasajero555',
        valoracion: 5,
        comentario: 'Excelente',
        viajeId: null
      });
      expect(
        valoracionRegistradaPublisher.publicarValoracionRegistrada.calls.length
      ).toBe(1);
      expect(res.status.calls[0][0]).toBe(201);
      expect(res.json.calls[0][0].eventoEmitido).toBe(true);
    });

    test('debe retornar 201 con eventoEmitido=false si RabbitMQ falla al publicar', async () => {
      req.body = {
        evaluadorId: 'cond1',
        evaluadoId: 'pasajero1',
        valoracion: 5
      };
      const valoracionGuardada = {
        id: 'val_1',
        evaluadorId: 'cond1',
        evaluadoId: 'pasajero1',
        valoracion: 5,
        comentario: '',
        viajeId: null,
        fecha: '2026-10-05T15:00:00.000Z'
      };
      redisRepository.registrarValoracion.mockResolvedValue(valoracionGuardada);
      valoracionRegistradaPublisher.publicarValoracionRegistrada.mockResolvedValue(
        false
      );

      await valoracionesController.crearValoracion(req, res);

      expect(res.status.calls[0][0]).toBe(201);
      expect(res.json.calls[0][0]).toEqual({
        ...valoracionGuardada,
        eventoEmitido: false
      });
    });

    test('debe retornar 400 si el repositorio lanza un error', async () => {
      req.body = { evaluadorId: 'cond1', evaluadoId: 'pasajero1', valoracion: 5 };
      redisRepository.registrarValoracion.mockRejectedValue(new Error('Error DB'));

      await valoracionesController.crearValoracion(req, res);

      expect(
        valoracionRegistradaPublisher.publicarValoracionRegistrada.calls.length
      ).toBe(0);
      expect(res.status.calls[0][0]).toBe(400);
      expect(res.json.calls[0][0]).toEqual({
        error: 'Solicitud inválida al registrar valoración',
        detalle: 'Error DB'
      });
    });
  });
});
