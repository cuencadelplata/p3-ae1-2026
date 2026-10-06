const redisRepository = require('../repositories/redisRepository');
const Conductor = require('../models/Conductor');
const eventPublisher = require('../events/eventPublisher');

// Valores válidos según el CHECK de la tabla `conductores` (src/schema/conductores.sql)
const ESTADOS_HABILITACION = ['pendiente', 'activo', 'suspendido', 'rechazado'];

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

/**
 * PUT /conductores/:id/disponible
 * RF 3.3 - El conductor informa su disponibilidad (heartbeat). Se guarda sólo
 * en Redis y, si el valor cambió respecto del anterior, se emite el evento
 * asíncrono DriverAvailabilityUpdated (RNF-07). Un heartbeat que repite el
 * mismo valor sólo renueva el TTL y no genera evento.
 * Body: { "disponible": true | false }
 */
const actualizarDisponible = async (req, res) => {
  try {
    const { id } = req.params;
    const { disponible } = req.body || {};

    if (typeof disponible !== 'boolean') {
      return res.status(400).json({ error: "El campo 'disponible' es requerido y debe ser booleano" });
    }

    const resultado = await redisRepository.actualizarDisponibilidad(id, disponible);
    const cambio = resultado.disponible !== resultado.disponibleAnterior;

    if (cambio) {
      // Fire-and-forget: la respuesta HTTP no espera al broker
      eventPublisher.publicarDriverAvailabilityUpdated(resultado);
    }

    return res.status(200).json({ ...resultado, eventoEmitido: cambio });
  } catch (error) {
    return res.status(500).json({ error: 'Error al actualizar disponibilidad del conductor', detalle: error.message });
  }
};

/**
 * PUT /conductores/:id/habilitado
 * RF 3.1 - Cambia el estado de habilitación del conductor (persistido en DB y
 * refrescado en la caché de Redis). Si el estado cambió se emite el evento
 * asíncrono DriverStatusChanged (RNF-07).
 * Body: { "habilitado": "pendiente" | "activo" | "suspendido" | "rechazado", "motivo"?: string }
 */
const actualizarHabilitado = async (req, res) => {
  try {
    const { id } = req.params;
    const { habilitado, motivo } = req.body || {};

    if (!ESTADOS_HABILITACION.includes(habilitado)) {
      return res.status(400).json({
        error: `El campo 'habilitado' debe ser uno de: ${ESTADOS_HABILITACION.join(', ')}`
      });
    }

    const resultado = await redisRepository.actualizarHabilitado(id, habilitado);

    if (!resultado) {
      return res.status(404).json({ error: `Conductor con ID '${id}' no encontrado` });
    }

    const cambio = resultado.habilitado !== resultado.habilitadoAnterior;

    if (cambio) {
      eventPublisher.publicarDriverStatusChanged({ ...resultado, motivo });
    }

    return res.status(200).json({ ...resultado, eventoEmitido: cambio });
  } catch (error) {
    return res.status(500).json({ error: 'Error al actualizar habilitación del conductor', detalle: error.message });
  }
};

/**
 * Función auxiliar para verificar si un conductor está habilitado
 */
const esHabilitado = (conductor) => {
  if (!conductor) return false;
  if (typeof conductor.habilitado === 'boolean') return conductor.habilitado;
  return conductor.habilitado === 'activo' || conductor.habilitado === 'habilitado';
};

/**
 * Función auxiliar para verificar si un conductor está disponible
 */
const esDisponible = (conductor) => {
  if (!conductor) return false;
  const hab = esHabilitado(conductor);
  const conn = conductor.estado_conexion === 'conectado' || conductor.estado_conexion === 'disponible';
  return hab && conn;
};

/**
 * Construye la estructura común de respuesta para estado/habilitado/disponible
 */
const construirRespuestaEstado = (conductor) => {
  return {
    usuarioID: conductor.usuarioID,
    habilitado: esHabilitado(conductor),
    disponible: esDisponible(conductor),
    estado: conductor.habilitado || 'pendiente',
    estado_conexion: conductor.estado_conexion || 'desconectado'
  };
};

/**
 * GET /conductor/:id/estado
 * Obtener estado completo (habilitado y disponible) de un conductor
 */
const obtenerEstadoConductor = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ error: 'ID de conductor es requerido' });
    }

    const conductor = await redisRepository.obtenerConductorPorId(id);
    if (!conductor) {
      return res.status(404).json({ error: `Conductor con ID '${id}' no encontrado` });
    }

    return res.status(200).json(construirRespuestaEstado(conductor));
  } catch (error) {
    return res.status(500).json({ error: 'Error al obtener estado del conductor desde Redis', detalle: error.message });
  }
};

/**
 * GET /conductor/:id/habilitado
 * Consulta específica si un conductor está habilitado (mantiene la misma estructura)
 */
const obtenerHabilitadoConductor = async (req, res) => {
  return obtenerEstadoConductor(req, res);
};

/**
 * GET /conductor/:id/disponible
 * Consulta específica si un conductor está disponible (mantiene la misma estructura)
 */
const obtenerDisponibleConductor = async (req, res) => {
  return obtenerEstadoConductor(req, res);
};

module.exports = {
  obtenerConductores,
  obtenerConductorPorId,
  crearConductor,
  obtenerHabilitado,
  obtenerDisponible,
  actualizarDisponible,
  actualizarHabilitado,
  obtenerEstadoConductor,
  obtenerHabilitadoConductor,
  obtenerDisponibleConductor
};

