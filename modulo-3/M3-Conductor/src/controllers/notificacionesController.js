const redisRepository = require("../repositories/redisRepository");
const hub = require("../modules/valoraciones/notificaciones.hub");

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
  streamNotificaciones
};
