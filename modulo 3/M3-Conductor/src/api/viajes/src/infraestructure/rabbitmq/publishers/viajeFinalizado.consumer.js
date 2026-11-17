const {
  getRabbitChannel
} = require(
  "../../../infrastructure/rabbitmq/rabbitmq.client"
);

const topology = require(
  "../../../infrastructure/rabbitmq/rabbitmq.topology"
);

const {
  procesarViajeFinalizado
} = require(
  "../valoraciones.service"
);

async function startViajeFinalizadoConsumer() {
  const channel = getRabbitChannel();

  const exchange =
    topology.exchanges.VIAJES;

  const queue =
    topology.queues
      .VIAJE_FINALIZADO_VALORACIONES;

  const routingKey =
    topology.routingKeys.VIAJE_FINALIZADO;

  // Crear/verificar exchange
  await channel.assertExchange(
    exchange,
    "topic",
    {
      durable: true
    }
  );

  // Crear/verificar cola
  await channel.assertQueue(
    queue,
    {
      durable: true
    }
  );

  // Vincular:
  // viaje.finalizado → cola de valoraciones
  await channel.bindQueue(
    queue,
    exchange,
    routingKey
  );

  console.log(
    `[RabbitMQ] Escuchando ${routingKey}`
  );

  channel.consume(
    queue,
    async (message) => {
      if (!message) {
        return;
      }

      try {
        const event = JSON.parse(
          message.content.toString()
        );

        console.log(
          "[RabbitMQ] viaje.finalizado recibido:",
          event
        );

        await procesarViajeFinalizado(
          event
        );

        // Confirmamos solamente después
        // de procesarlo correctamente
        channel.ack(message);

      } catch (error) {
        console.error(
          "[RabbitMQ] Error procesando viaje.finalizado:",
          error
        );

        channel.nack(
          message,
          false,
          false
        );
      }
    }
  );
}

module.exports = {
  startViajeFinalizadoConsumer
};