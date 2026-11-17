const rabbitmq = require("../config/rabbitmqClient");
const { EVENTOS, driverAvailabilityUpdated, driverStatusChanged } = require("./driverEvents");

/**
 * Producer genérico: publica un evento en el exchange topic del módulo.
 *
 * - Mensajes persistentes (deliveryMode 2) sobre un exchange durable.
 * - ConfirmChannel: se espera el ack del broker antes de dar por publicado.
 * - Nunca lanza: si RabbitMQ no está disponible se loguea y devuelve false, de
 *   modo que la operación HTTP que originó el evento no falla por la mensajería
 *   (el estado ya quedó guardado en Redis/DB, el evento es una notificación).
 *
 * @returns {Promise<boolean>} true si el broker confirmó el mensaje
 */
async function publicar(routingKey, evento) {
  try {
    const channel = await rabbitmq.getChannel();
    const payload = Buffer.from(JSON.stringify(evento));

    channel.publish(rabbitmq.EXCHANGE, routingKey, payload, {
      persistent: true,
      contentType: "application/json",
      messageId: evento.eventId,
      type: evento.eventType,
      timestamp: Math.floor(Date.parse(evento.occurredAt) / 1000),
      appId: evento.source
    });
    await channel.waitForConfirms();

    console.log(`[RabbitMQ] Evento publicado ${evento.eventType} (${routingKey}) id=${evento.eventId}`);
    return true;
  } catch (err) {
    console.error(`[RabbitMQ] No se pudo publicar ${evento.eventType} (${routingKey}): ${err.message}`);
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
