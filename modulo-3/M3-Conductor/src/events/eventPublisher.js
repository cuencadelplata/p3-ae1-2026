const gateway = require("../infraestructure/messagingGateway");
const rabbitmq = require("../config/rabbitmqClient");
const { EVENTOS, driverAvailabilityUpdated, driverStatusChanged } = require("./driverEvents");

/**
 * Producer genérico: publica un evento en el exchange topic del módulo.
 *
 * - Mensajes persistentes (deliveryMode 2) sobre un exchange durable.
 * - ConfirmChannel: se espera el ack del broker antes de dar por publicado.
 * - Nunca lanza: si ni RabbitMQ ni la cola temporal aceptan el evento, se
 *   loguea y devuelve false. La operación HTTP no falla por la mensajería.
 *
 * @returns {Promise<boolean>} true si el broker confirmó el mensaje
 */
async function publicar(routingKey, evento) {
  try {
    const payload = Buffer.from(JSON.stringify(evento));
    const broker = await gateway.publish({
      exchange: rabbitmq.EXCHANGE,
      routingKey,
      content: payload,
      options: {
        persistent: true,
        contentType: "application/json",
        messageId: evento.eventId,
        type: evento.eventType,
        timestamp: Math.floor(Date.parse(evento.occurredAt) / 1000),
        appId: evento.source
      },
      prepare: async (channel) => {
        await channel.assertExchange(rabbitmq.EXCHANGE, "topic", { durable: true });
      }
    });

    console.log(`[${broker}] Evento publicado ${evento.eventType} (${routingKey}) id=${evento.eventId}`);
    return true;
  } catch (err) {
    console.error(`[Circuit] No se pudo publicar ${evento.eventType} (${routingKey}): ${err.message}`);
    return false;
  }
}

function publicarDriverAvailabilityUpdated(datos) {
  return publicar(EVENTOS.DRIVER_AVAILABILITY_UPDATED.routingKey, driverAvailabilityUpdated(datos));
}

function publicarDriverStatusChanged(datos) {
  return publicar(EVENTOS.DRIVER_STATUS_CHANGED.routingKey, driverStatusChanged(datos));
}

module.exports = {
  publicar,
  publicarDriverAvailabilityUpdated,
  publicarDriverStatusChanged
};
