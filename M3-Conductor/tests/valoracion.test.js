const Valoracion = require('../src/models/Valoracion');
const valoracionesController = require('../src/controllers/valoracionesController');
const redisRepository = require('../src/repositories/redisRepository');

// Mock del cliente redis para evitar sockets/conexiones colgadas en background
jest.mock('../src/config/redisClient', () => ({
  on: jest.fn(),
  quit: jest.fn(),
  disconnect: jest.fn()
}));

// Mock del repositorio de redis
jest.mock('../src/repositories/redisRepository');

describe('Modelo Valoracion', () => {
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

describe('Controlador Valoraciones (valoracionesController)', () => {
  let req, res;

  beforeEach(() => {
    jest.clearAllMocks();
    req = {
      query: {},
      body: {}
    };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis()
    };
  });

  describe('obtenerValoraciones', () => {
    test('debe retornar 400 si no se envía usuarioId ni conductorId en query', async () => {
      req.query = {};

      await valoracionesController.obtenerValoraciones(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
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

      expect(redisRepository.obtenerValoraciones).toHaveBeenCalledWith('cond1');
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(mockValoraciones);
    });

    test('debe aceptar conductorId en la query si usuarioId no está presente', async () => {
      req.query = { conductorId: 'cond2' };
      const mockValoraciones = [];
      redisRepository.obtenerValoraciones.mockResolvedValue(mockValoraciones);

      await valoracionesController.obtenerValoraciones(req, res);

      expect(redisRepository.obtenerValoraciones).toHaveBeenCalledWith('cond2');
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(mockValoraciones);
    });

    test('debe retornar 500 en caso de falla del repositorio', async () => {
      req.query = { usuarioId: 'cond1' };
      redisRepository.obtenerValoraciones.mockRejectedValue(new Error('Fallo de conexión'));

      await valoracionesController.obtenerValoraciones(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Error al obtener valoraciones desde Redis',
        detalle: 'Fallo de conexión'
      });
    });
  });

  describe('crearValoracion', () => {
    test('debe retornar 400 si falta el ID del conductor', async () => {
      req.query = {};
      req.body = { valoracion: 5 };

      await valoracionesController.crearValoracion(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Falta el ID del conductor (usuarioId en query o conductorId en body)'
      });
    });

    test('debe retornar 400 si la valoración no está entre 1 y 5 (ej. menor a 1)', async () => {
      req.query = { usuarioId: 'cond1' };
      req.body = { valoracion: 0 };

      await valoracionesController.crearValoracion(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: 'La valoración debe ser un número entre 1 y 5'
      });
    });

    test('debe retornar 400 si la valoración no está entre 1 y 5 (ej. mayor a 5)', async () => {
      req.query = { usuarioId: 'cond1' };
      req.body = { valoracion: 6 };

      await valoracionesController.crearValoracion(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
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

      expect(redisRepository.registrarValoracion).toHaveBeenCalledWith({
        conductorId: 'cond1',
        usuarioId: 'pasajero_anonimo',
        valoracion: 4,
        comentario: 'Todo bien'
      });
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith(valoracionGuardada);
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

      expect(redisRepository.registrarValoracion).toHaveBeenCalledWith({
        conductorId: 'cond1',
        usuarioId: 'usr555',
        valoracion: 5,
        comentario: 'Excelente'
      });
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith(valoracionGuardada);
    });

    test('debe retornar 400 si el repositorio lanza un error', async () => {
      req.query = { usuarioId: 'cond1' };
      req.body = { valoracion: 5 };
      redisRepository.registrarValoracion.mockRejectedValue(new Error('Error DB'));

      await valoracionesController.crearValoracion(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Solicitud inválida al registrar valoración',
        detalle: 'Error DB'
      });
    });
  });
});
