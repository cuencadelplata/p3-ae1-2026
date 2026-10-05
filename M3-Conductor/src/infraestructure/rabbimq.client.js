const amqp = require("amqplib");

let connection;
let channel;

async function connectRabbitMQ() {
  if (channel) {
    return channel;
  }

  const rabbitUrl =
    process.env.RABBITMQ_URL ||
    "amqp://admin:admin123@localhost:5672";

  connection = await amqp.connect(rabbitUrl);

  channel = await connection.createChannel();

  console.log("[RabbitMQ] Conexión establecida");

  return channel;
}

function getRabbitChannel() {
  if (!channel) {
    throw new Error(
      "RabbitMQ todavía no fue inicializado"
    );
  }

  return channel;
}

module.exports = {
  connectRabbitMQ,
  getRabbitChannel
};