const amqp = require("amqplib");

let connection;
let channel;

const EXCHANGE = "viajes.events";

async function connectRabbitMQ() {
  connection = await amqp.connect(process.env.RABBITMQ_URL);

  channel = await connection.createConfirmChannel();

  await channel.assertExchange(
    EXCHANGE,
    "topic",
    {
      durable: true
    }
  );

  console.log("[RabbitMQ] Módulo Viajes conectado");

  return channel;
}

function getChannel() {
  if (!channel) {
    throw new Error("RabbitMQ todavía no está inicializado");
  }

  return channel;
}

module.exports = {
  connectRabbitMQ,
  getChannel,
  EXCHANGE
};