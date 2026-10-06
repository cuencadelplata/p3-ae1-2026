const redisRepository = require('../repositories/redisRepository');
const Valoracion = require('../models/Valoracion');

/**
 * GET /conductor/valoraciones
 * Obtener las valoraciones de un conductor por usuarioId desde Redis
 */
const obtenerValoraciones = async (req, res) => {
  try {
    const conductorId = req.query.usuarioId || req.query.conductorId;

    if (!conductorId) {
      return res.status(400).json({ error: 'Debe proporcionar el parámetro \'usuarioId\' en la query' });
    }

    const valoraciones = await redisRepository.obtenerValoraciones(conductorId);
    return res.status(200).json(valoraciones);
  } catch (error) {
    return res.status(500).json({ error: 'Error al obtener valoraciones desde Redis', detalle: error.message });
  }
};

/**
 * POST /conductor/valoraciones
 * Registrar la valoración de un conductor en Redis
 */
const crearValoracion = async (req, res) => {
  try {
    const conductorId = req.query.usuarioId || req.query.conductorId || (req.body && req.body.conductorId);
    const { usuarioId, valoracion, comentario } = req.body || {};

    if (!conductorId) {
      return res.status(400).json({ error: 'Falta el ID del conductor (usuarioId en query o conductorId en body)' });
    }

    if (valoracion === undefined || valoracion < 1 || valoracion > 5) {
      return res.status(400).json({ error: 'La valoración debe ser un número entre 1 y 5' });
    }

    const modelValoracion = new Valoracion(
      usuarioId || 'pasajero_anonimo',
      conductorId,
      Number(valoracion),
      comentario || ''
    );

    const nuevaValoracion = await redisRepository.registrarValoracion({
      conductorId: modelValoracion.getConductorId(),
      usuarioId: modelValoracion.getUsuarioId(),
      valoracion: modelValoracion.getValoracion(),
      comentario: modelValoracion.getComentario()
    });

    return res.status(201).json(nuevaValoracion);
  } catch (error) {
    return res.status(400).json({ error: 'Solicitud inválida al registrar valoración', detalle: error.message });
  }
};

module.exports = {
  obtenerValoraciones,
  crearValoracion
};
