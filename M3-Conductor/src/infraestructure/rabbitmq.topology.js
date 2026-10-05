module.exports = {
  exchanges: {
    VIAJES: "viajes.events",
    VALORACIONES: "valoraciones.events"
  },

  queues: {
    VIAJE_FINALIZADO_VALORACIONES: "valoraciones.viaje-finalizado",
    VALORACION_HABILITADA_CLIENTE: "cliente.valoracion-habilitada"
  },

  routingKeys: {
    VIAJE_FINALIZADO: "viaje.finalizado",
    VALORACION_HABILITADA: "valoracion.habilitada"
  }
};