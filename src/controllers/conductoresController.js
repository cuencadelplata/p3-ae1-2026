const supabase = require('../config/SupabaseClient');
const Conductor = require('../models/Conductor');

/**
 * GET /conductores
 * Pedir la lista completa de conductores registrados en la base de datos.
 */
const obtenerConductores = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('conductores')
      .select('*');

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({ error: 'Error al obtener el listado de conductores', details: err.message });
  }
};

/**
 * GET /conductores/:id
 * Obtener un conductor específico por su ID.
 */
const obtenerConductorPorId = async (req, res) => {
  const { id } = req.params;

  if (!id) {
    return res.status(400).json({ error: 'ID de conductor es requerido' });
  }

  try {
    const { data, error } = await supabase
      .from('conductores')
      .select('*')
      .eq('usuarioID', id)
      .single();

    if (error || !data) {
      return res.status(404).json({ error: 'Conductor no encontrado' });
    }

    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({ error: 'Error al obtener el conductor', details: err.message });
  }
};

/**
 * POST /conductores
 * Crear un nuevo conductor.
 */
const crearConductor = async (req, res) => {
  const { usuarioID, ciudad, tipovehiculo, licenciaId, vehiculoId } = req.body;

  if (!usuarioID || !ciudad || !tipovehiculo || !licenciaId || !vehiculoId) {
    return res.status(400).json({ error: 'Solicitud inválida: Faltan campos requeridos' });
  }

  try {
    const nuevoConductor = new Conductor(
      usuarioID,
      ciudad,
      tipovehiculo,
      licenciaId,
      vehiculoId
    );

    const { data, error } = await supabase
      .from('conductores')
      .insert([
        {
          usuarioID: nuevoConductor.usuarioID,
          ciudad: nuevoConductor.ciudad,
          tipovehiculo: nuevoConductor.tipovehiculo,
          licenciaId: nuevoConductor.licenciaId,
          vehiculoId: nuevoConductor.vehiculoId,
          habilitado: nuevoConductor.habilitado,
          estado_conexion: nuevoConductor.estado_conexion
        }
      ])
      .select();

    if (error) {
      return res.status(400).json({ error: 'Solicitud inválida', details: error.message });
    }

    return res.status(201).json(data ? data[0] : nuevoConductor);
  } catch (err) {
    return res.status(400).json({ error: 'Solicitud inválida', details: err.message });
  }
};

module.exports = {
  obtenerConductores,
  obtenerConductorPorId,
  crearConductor
};
