const redisRepository = require("../repositories/redisRepository");
const hub = require("../modules/valoraciones/notificaciones.hub");
const {
  ejecutarDemoViajeFinalizado
} = require("../modules/valoraciones/demoViajeFinalizado.service");

async function obtenerPendientes(_req, res) {
  try {
    const pendientes = await redisRepository.listarValoracionesPendientes();
    return res.status(200).json(pendientes);
  } catch (error) {
    return res.status(500).json({
      error: "Error al listar valoraciones pendientes",
      detalle: error.message
    });
  }
}

/**
 * POST /valoraciones/demo-viaje-finalizado
 * Ejecuta el ciclo real de M6 (crear→asignar→arribo→iniciar→finalizar)
 * para que viaje.finalizado llegue a valoraciones por RabbitMQ.
 */
async function demoViajeFinalizado(req, res) {
  try {
    const resultado = await ejecutarDemoViajeFinalizado(req.body || {}, {
      authorization: req.headers && req.headers.authorization
    });
    return res.status(200).json(resultado);
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({
      error: error.message || "No se pudo completar el viaje de prueba en M6",
      paso: error.paso || null,
      upstreamStatus: error.upstreamStatus || null,
      upstream: error.upstream || null
    });
  }
}

function obtenerNotificaciones(_req, res) {
  return res.status(200).json(hub.listarNotificaciones());
}

function streamNotificaciones(req, res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no"
  });
  res.write(": connected\n\n");

  const cancelar = hub.suscribir(res);
  const ping = setInterval(() => {
    res.write(": ping\n\n");
  }, 15000);

  req.on("close", () => {
    clearInterval(ping);
    cancelar();
  });
}

module.exports = {
  obtenerPendientes,
  obtenerNotificaciones,
  streamNotificaciones,
  demoViajeFinalizado
};
