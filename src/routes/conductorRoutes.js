const express = require("express");
const router = express.Router();
const redisRepository = require("../repositories/redisRepository");

/**
 * GET /conductores
 * Listado de conductores
 */
router.get("/conductores", async (_req, res) => {
  try {
    const conductores = await redisRepository.obtenerConductores();
    res.status(200).json(conductores);
  } catch (error) {
    res.status(500).json({ error: "Error al obtener conductores", detalle: error.message });
  }
});

/**
 * GET /conductores/:id
 * Obtener un conductor por ID
 */
router.get("/conductores/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const conductor = await redisRepository.obtenerConductorPorId(id);

    if (!conductor) {
      return res.status(404).json({ error: `Conductor con ID '${id}' no encontrado` });
    }

    res.status(200).json(conductor);
  } catch (error) {
    res.status(500).json({ error: "Error al buscar conductor", detalle: error.message });
  }
});

/**
 * POST /conductores/ (y /conductores/create)
 * Crear un nuevo conductor
 */
const crearConductorHandler = async (req, res) => {
  try {
    const datos = req.body;

    if (!datos || Object.keys(datos).length === 0) {
      return res.status(400).json({ error: "El cuerpo de la solicitud no puede estar vacío" });
    }

    const nuevoConductor = await redisRepository.crearConductor(datos);
    res.status(201).json(nuevoConductor);
  } catch (error) {
    res.status(500).json({ error: "Error al crear conductor", detalle: error.message });
  }
};

router.post("/conductores", crearConductorHandler);
router.post("/conductores/", crearConductorHandler);
router.post("/conductores/create", crearConductorHandler);

/**
 * GET /conductor/valoraciones
 * Obtener las valoraciones de un conductor
 * Parámetro: usuarioId (query)
 */
router.get("/conductor/valoraciones", async (req, res) => {
  try {
    const conductorId = req.query.usuarioId || req.query.conductorId;

    if (!conductorId) {
      return res.status(400).json({ error: "Debe proporcionar el parámetro 'usuarioId' en la query" });
    }

    const valoraciones = await redisRepository.obtenerValoraciones(conductorId);
    res.status(200).json(valoraciones);
  } catch (error) {
    res.status(500).json({ error: "Error al obtener valoraciones", detalle: error.message });
  }
});

/**
 * POST /conductor/valoraciones
 * Registrar la valoración de un conductor
 * Parámetro: usuarioId (query) + body
 */
router.post("/conductor/valoraciones", async (req, res) => {
  try {
    const conductorId = req.query.usuarioId || req.query.conductorId || req.body.conductorId;
    const { usuarioId, valoracion, comentario } = req.body;

    if (!conductorId) {
      return res.status(400).json({ error: "Falta el ID del conductor (usuarioId en query o conductorId en body)" });
    }

    if (valoracion === undefined || valoracion < 1 || valoracion > 5) {
      return res.status(400).json({ error: "La valoración debe ser un número entero entre 1 y 5" });
    }

    const nuevaValoracion = await redisRepository.registrarValoracion({
      conductorId,
      usuarioId: usuarioId || "pasajero_anonimo",
      valoracion,
      comentario
    });

    res.status(201).json(nuevaValoracion);
  } catch (error) {
    res.status(500).json({ error: "Error al registrar valoración", detalle: error.message });
  }
});

module.exports = router;
