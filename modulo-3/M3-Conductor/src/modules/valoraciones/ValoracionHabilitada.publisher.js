const crypto = require("crypto");
const gateway = require("../../infraestructure/messagingGateway");
const topology = require("../../infraestructure/rabbitmq.topology");

async function publicarValoracionHabilitada(valoracion) {
  const exchange = topology.exchanges.VALORACIONES;
  const queue = topology.queues.VALORACION_HABILITADA_CLIENTE;
  const routingKey = topology.routingKeys.VALORACION_HABILITADA;

  const evento = {
    eventId: crypto.randomUUID(),
    eventType: "valoracion.habilitada",
    occurredAt: new Date().toISOString(),
    data: valoracion
  };

  const broker = await gateway.publish({
    exchange,
    routingKey,
    content: Buffer.from(JSON.stringify(evento)),
    options: { persistent: true, contentType: "application/json" },
    prepare: async (channel) => {
      await channel.assertExchange(exchange, "topic", { durable: true });
      await channel.assertQueue(queue, { durable: true });
      await channel.bindQueue(queue, exchange, routingKey);
    }
  });

  console.log(`[${broker}] valoracion.habilitada publicada (${evento.eventId})`);
}

module.exports = { publicarValoracionHabilitada };