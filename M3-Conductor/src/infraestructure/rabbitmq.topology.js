module.exports = {
  exchanges: {
    VIAJES: "viajes.events"
  },

  queues: {
    VIAJE_FINALIZADO_VALORACIONES:
      "valoraciones.viaje-finalizado"
  },

  routingKeys: {
    VIAJE_FINALIZADO:
      "viaje.finalizado"
  }
};