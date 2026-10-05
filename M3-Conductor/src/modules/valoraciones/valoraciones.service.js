const { guardarValoracionPendiente } = require("../../repositories/redisRepository");
const { publicarValoracionHabilitada } = require("./ValoracionHabilitada.publisher");

async function procesarViajeFinalizado(event) {
  if (
    event.eventType !==
    "viaje.finalizado"
  ) {
    throw new Error(
      "Tipo de evento inválido"
    );
  }

  if (!event.data) {
    throw new Error(
      "El evento no contiene data"
    );
  }

  const {
    viajeId,
    conductorId,
    clienteId,
    finalizadoAt
  } = event.data;

  if (!viajeId) {
    throw new Error(
      "viajeId es obligatorio"
    );
  }

  if (!conductorId) {
    throw new Error(
      "conductorId es obligatorio"
    );
  }

  if (!clienteId) {
    throw new Error(
      "clienteId es obligatorio"
    );
  }

  const valoracionPendiente = {
    viajeId,
    evaluadorId: conductorId,
    evaluadoId: clienteId,
    estado: "PENDIENTE",
    habilitadaDesde:
      finalizadoAt || new Date().toISOString()
  };

  await guardarValoracionPendiente(valoracionPendiente);
  await publicarValoracionHabilitada(valoracionPendiente);

  console.log("[Valoraciones] Valoración habilitada:", valoracionPendiente.viajeId);
  
  return valoracionPendiente;
}

module.exports = {
  procesarViajeFinalizado
};