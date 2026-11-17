const { getRabbitChannel } = require("../../../infraestructure/rabbimq.client");
const topology = require("../../../infraestructure/rabbitmq.topology");
const { publicarNotificacion } = require("../notificaciones.hub");

async function startValoracionHabilitadaConsumer() {
  const channel = getRabbitChannel();

  const exchange = topology.exchanges.VALORACIONES;
  const queue = topology.queues.VALORACION_HABILITADA_PANEL;
  const routingKey = topology.routingKeys.VALORACION_HABILITADA;

  await channel.assertExchange(exchange, "topic", { durable: true });
  await channel.assertQueue(queue, { durable: true });
  await channel.bindQueue(queue, exchange, routingKey);

  console.log(`[RabbitMQ] Escuchando ${routingKey} para el panel`);

  channel.consume(queue, (message) => {
    if (!message) return;

    try {
      const event = JSON.parse(message.content.toString());

      if (event.eventType !== "valoracion.habilitada") {
        throw new Error("Tipo de evento inválido");
      }

      console.log("[RabbitMQ] valoracion.habilitada recibida:", event.eventId);
      publicarNotificacion(event);
      channel.ack(message);
    } catch (error) {
      console.error("[RabbitMQ] Error procesando valoracion.habilitada:", error.message);
      channel.nack(message, false, false);
    }
  });
}

module.exports = { startValoracionHabilitadaConsumer };
