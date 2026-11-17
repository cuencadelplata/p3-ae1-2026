const crypto = require("crypto");
const { getRabbitChannel } = require("../../infraestructure/rabbimq.client");
const topology = require("../../infraestructure/rabbitmq.topology");

async function publicarValoracionHabilitada(valoracion) {
  const channel = getRabbitChannel();
  const exchange = topology.exchanges.VALORACIONES;
  const queue = topology.queues.VALORACION_HABILITADA_CLIENTE;
  const routingKey = topology.routingKeys.VALORACION_HABILITADA;

  await channel.assertExchange(exchange, "topic", { durable: true });
  await channel.assertQueue(queue, { durable: true });
  await channel.bindQueue(queue, exchange, routingKey);

  const evento = {
    eventId: crypto.randomUUID(),
    eventType: "valoracion.habilitada",
    occurredAt: new Date().toISOString(),
    data: valoracion
  };

  channel.publish(
    exchange,
    routingKey,
    Buffer.from(JSON.stringify(evento)),
    { persistent: true, contentType: "application/json" }
  );
}

module.exports = { publicarValoracionHabilitada };