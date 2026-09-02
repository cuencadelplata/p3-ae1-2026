const supabase = require('../config/SupabaseClient');
const Valoracion = require('../models/Valoracion');

/**
 * GET /conductor/valoraciones
 * Obtener las valoraciones de un conductor por usuarioId (query param).
 */
const obtenerValoraciones = async (req, res) => {
  const { usuarioId } = req.query;

  if (!usuarioId) {
    return res.status(400).json({ error: 'El parámetro usuarioId es requerido' });
  }

  try {
    const { data, error } = await supabase
      .from('valoraciones')
      .select('*')
      .eq('conductorId', usuarioId);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    if (!data || data.length === 0) {
      return res.status(404).json({ error: 'Conductor no encontrado o sin valoraciones' });
    }

    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({ error: 'Error al obtener las valoraciones', details: err.message });
  }
};

/**
 * POST /conductor/valoraciones
 * Registrar la valoración de un conductor.
 */
const crearValoracion = async (req, res) => {
  const usuarioIdQuery = req.query.usuarioId;
  const { usuarioId, conductorId, valoracion, comentario } = req.body || {};

  const targetConductorId = conductorId || usuarioIdQuery;
  const targetUsuarioId = usuarioId || usuarioIdQuery;

  if (!targetConductorId || valoracion === undefined) {
    return res.status(400).json({ error: 'Solicitud inválida: Faltan campos requeridos para la valoración' });
  }

  try {
    const nuevaValoracion = new Valoracion(
      targetUsuarioId,
      targetConductorId,
      valoracion,
      comentario || ''
    );

    const { data, error } = await supabase
      .from('valoraciones')
      .insert([
        {
          usuarioId: nuevaValoracion.getUsuarioId(),
          conductorId: nuevaValoracion.getConductorId(),
          valoracion: nuevaValoracion.getValoracion(),
          comentario: nuevaValoracion.getComentario()
        }
      ])
      .select();

    if (error) {
      return res.status(400).json({ error: 'Solicitud inválida', details: error.message });
    }

    return res.status(201).json({
      message: 'Valoración registrada correctamente',
      data: data ? data[0] : nuevaValoracion
    });
  } catch (err) {
    return res.status(400).json({ error: 'Solicitud inválida', details: err.message });
  }
};

module.exports = {
  obtenerValoraciones,
  crearValoracion
};
