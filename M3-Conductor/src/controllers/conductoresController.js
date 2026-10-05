const redisRepository = require('../repositories/redisRepository');
const Conductor = require('../models/Conductor');

/**
 * GET /conductores
 * Listado de conductores registrados en Redis
 */
const obtenerConductores = async (req, res) => {
  try {
    const conductores = await redisRepository.obtenerConductores();
    return res.status(200).json(conductores);
  } catch (error) {
    return res.status(500).json({ error: 'Error al obtener conductores desde Redis', detalle: error.message });
  }
};

/**
 * GET /conductores/:id
 * Obtener un conductor por ID desde Redis
 */
const obtenerConductorPorId = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ error: 'ID de conductor es requerido' });
    }

    const conductor = await redisRepository.obtenerConductorPorId(id);

    if (!conductor) {
      return res.status(404).json({ error: `Conductor con ID '${id}' no encontrado` });
    }

    return res.status(200).json(conductor);
  } catch (error) {
    return res.status(500).json({ error: 'Error al obtener conductor desde Redis', detalle: error.message });
  }
};

/**
 * POST /conductores
 * Crear un nuevo conductor en Redis
 */
const crearConductor = async (req, res) => {
  try {
    const { usuarioID, ciudad, tipovehiculo, licenciaId, vehiculoId } = req.body || {};

    if (!usuarioID && (!req.body || Object.keys(req.body).length === 0)) {
      return res.status(400).json({ error: 'Solicitud inválida: El cuerpo no puede estar vacío' });
    }

    const nuevoConductorModel = new Conductor(
      usuarioID,
      ciudad,
      tipovehiculo,
      licenciaId,
      vehiculoId
    );

    const datos = {
      usuarioID: nuevoConductorModel.usuarioID || req.body.usuarioID,
      ciudad: nuevoConductorModel.ciudad || req.body.ciudad,
      tipovehiculo: nuevoConductorModel.tipovehiculo || req.body.tipovehiculo,
      licenciaId: nuevoConductorModel.licenciaId || req.body.licenciaId,
      vehiculoId: nuevoConductorModel.vehiculoId || req.body.vehiculoId,
      habilitado: nuevoConductorModel.habilitado || 'pendiente',
      estado_conexion: nuevoConductorModel.estado_conexion || 'desconectado'
    };

    const conductorCreado = await redisRepository.crearConductor(datos);
    return res.status(201).json(conductorCreado);
  } catch (error) {
    return res.status(400).json({ error: 'Solicitud inválida al crear conductor', detalle: error.message });
  }
};

/**
 * GET /conductores/:id/habilitado
 * RF 3.1 - Estado de habilitación del conductor.
 * Se resuelve primero contra la caché de Redis; en caso de "cache miss" el
 * repositorio consulta la base de datos y recarga la caché con TTL. Ningún
 * otro módulo debe consultar esto por SQL directo: este endpoint es la
 * única puerta de entrada al dato.
 */
const obtenerHabilitado = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ error: 'ID de conductor es requerido' });
    }

    const resultado = await redisRepository.obtenerHabilitado(id);

    if (!resultado) {
      return res.status(404).json({ error: `Conductor con ID '${id}' no encontrado` });
    }

    return res.status(200).json(resultado);
  } catch (error) {
    return res.status(500).json({ error: 'Error al obtener habilitación del conductor', detalle: error.message });
  }
};

/**
 * GET /conductores/:id/disponible
 * RF 3.3 - Estado efímero de disponibilidad del conductor.
 * Se resuelve exclusivamente contra Redis (clave con TTL tipo heartbeat), sin
 * tocar la base de datos, para que el Módulo 5 pueda consultarlo de forma
 * optimizada y con alta frecuencia durante el matching de viajes.
 */
const obtenerDisponible = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ error: 'ID de conductor es requerido' });
    }

    const resultado = await redisRepository.obtenerDisponibilidad(id);
    return res.status(200).json(resultado);
  } catch (error) {
    return res.status(500).json({ error: 'Error al obtener disponibilidad del conductor', detalle: error.message });
  }
};

module.exports = {
  obtenerConductores,
  obtenerConductorPorId,
  crearConductor,
  obtenerHabilitado,
  obtenerDisponible
};
