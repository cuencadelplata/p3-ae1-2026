const { getRabbitChannel } = require("../../../infraestructure/rabbimq.client");
const topology = require("../../../infraestructure/rabbitmq.topology");
const { procesarViajeFinalizado } = require("../valoraciones.service");

async function startViajeFinalizadoConsumer() {
  const channel = getRabbitChannel();

  const exchange = topology.exchanges.VIAJES;
  const queue = topology.queues.VIAJE_FINALIZADO_VALORACIONES;
  const routingKey = topology.routingKeys.VIAJE_FINALIZADO;

  await channel.assertExchange(exchange, "topic", { durable: true });
  await channel.assertQueue(queue, { durable: true });
  await channel.bindQueue(queue, exchange, routingKey);

  console.log(`[RabbitMQ] Escuchando ${routingKey}`);

  channel.consume(queue, async (message) => {
    if (!message) return;

    try {
      const event = JSON.parse(message.content.toString());
      console.log("[RabbitMQ] viaje.finalizado recibido:", event.eventId);

      await procesarViajeFinalizado(event);
      channel.ack(message);
    } catch (error) {
      console.error("[RabbitMQ] Error procesando viaje.finalizado:", error.message);

      const mensajeInvalido =
        error.message.includes("obligatorio") ||
        error.message.includes("inválido") ||
        error.message.includes("no contiene");

      // El tercer argumento es requeue. Un viaje mal armado no se reintenta.
      // Un fallo de Redis o de red sí vuelve a la cola.
      channel.nack(message, false, !mensajeInvalido);
    }
  });
}

module.exports = { startViajeFinalizadoConsumer };