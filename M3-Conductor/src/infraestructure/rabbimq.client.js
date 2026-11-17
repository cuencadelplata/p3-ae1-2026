const amqp = require("amqplib");

let connection;
let channel;

function rabbitUrl() {
  return process.env.RABBITMQ_URL || "amqp://admin:admin123@localhost:5672";
}

function reset() {
  connection = null;
  channel = null;
}

async function connectRabbitMQ() {
  if (channel) {
    return channel;
  }

  connection = await amqp.connect(rabbitUrl());
  connection.on("error", (error) => {
    console.error(`[RabbitMQ] Error de conexión: ${error.message}`);
  });
  connection.on("close", () => {
    console.warn("[RabbitMQ] Conexión cerrada");
    reset();
  });

  channel = await connection.createConfirmChannel();
  console.log("[RabbitMQ] Conexión establecida");
  return channel;
}

async function probeRabbitMQ() {
  const timeoutMs = Number(process.env.RABBITMQ_PROBE_TIMEOUT_MS || 2000);
  try {
    await Promise.race([
      connectRabbitMQ(),
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error("timeout")), timeoutMs);
      })
    ]);
    return true;
  } catch (error) {
    const current = connection;
    reset();
    if (current) {
      try {
        await current.close();
      } catch (_closeError) {
        // La sonda no deja la conexión a medias.
      }
    }
    return false;
  }
}

function getRabbitChannel() {
  if (!channel) {
    throw new Error("RabbitMQ todavía no fue inicializado");
  }
  return channel;
}

module.exports = {
  connectRabbitMQ,
  probeRabbitMQ,
  getRabbitChannel
};
