const redisRepository = require("../repositories/redisRepository");
const Valoracion = require("../models/Valoracion");
const {
  publicarValoracionRegistrada
} = require("../modules/valoraciones/ValoracionRegistrada.publisher");

/**
 * Resuelve el ID del conductor evaluador.
 * Preferir evaluadorId / conductorId. usuarioId en query ya no significa conductor.
 */
function resolverEvaluadorId(req) {
  const q = req.query || {};
  const b = req.body || {};
  return (
    q.evaluadorId ||
    q.conductorId ||
    b.evaluadorId ||
    b.conductorId ||
    null
  );
}

/**
 * Resuelve el ID del pasajero evaluado.
 * usuarioId / clienteId se interpretan solo como pasajero.
 */
function resolverEvaluadoId(body = {}) {
  return body.evaluadoId || body.clienteId || body.usuarioId || null;
}

/**
 * GET /conductor/valoraciones
 * Lista valoraciones hechas por un conductor (evaluador) sobre pasajeros.
 */
const obtenerValoraciones = async (req, res) => {
  try {
    const evaluadorId = resolverEvaluadorId(req);

    if (!evaluadorId) {
      return res.status(400).json({
        error:
          "Debe proporcionar el parámetro 'evaluadorId' o 'conductorId' en la query"
      });
    }

    const valoraciones = await redisRepository.obtenerValoraciones(evaluadorId);
    return res.status(200).json(valoraciones);
  } catch (error) {
    return res.status(500).json({
      error: "Error al obtener valoraciones desde Redis",
      detalle: error.message
    });
  }
};

/**
 * POST /conductor/valoraciones
 * El conductor (evaluador) registra una valoración del pasajero (evaluado)
 * y publica el evento valoracion.registrada.
 */
const crearValoracion = async (req, res) => {
  try {
    const body = req.body || {};
    const evaluadorId = resolverEvaluadorId(req);
    const evaluadoId = resolverEvaluadoId(body);
    const { valoracion, comentario, viajeId } = body;

    if (!evaluadorId) {
      return res.status(400).json({
        error:
          "Falta el ID del evaluador (evaluadorId o conductorId en query/body)"
      });
    }

    if (!evaluadoId) {
      return res.status(400).json({
        error:
          "Falta el ID del pasajero evaluado (evaluadoId, clienteId o usuarioId en body)"
      });
    }

    if (valoracion === undefined || valoracion < 1 || valoracion > 5) {
      return res
        .status(400)
        .json({ error: "La valoración debe ser un número entre 1 y 5" });
    }

    const model = new Valoracion(
      evaluadorId,
      evaluadoId,
      Number(valoracion),
      comentario || ""
    );

    const nuevaValoracion = await redisRepository.registrarValoracion({
      evaluadorId: model.getEvaluadorId(),
      evaluadoId: model.getEvaluadoId(),
      valoracion: model.getValoracion(),
      comentario: model.getComentario(),
      viajeId: viajeId || null
    });

    const eventoEmitido = await publicarValoracionRegistrada(nuevaValoracion);

    return res.status(201).json({ ...nuevaValoracion, eventoEmitido });
  } catch (error) {
    return res.status(400).json({
      error: "Solicitud inválida al registrar valoración",
      detalle: error.message
    });
  }
};

module.exports = {
  obtenerValoraciones,
  crearValoracion
};
