const { Kafka, logLevel } = require("kafkajs");

const TOPIC = process.env.KAFKA_FALLBACK_TOPIC || "m3.fallback";
const GROUP = "m3-fallback-drain";

let kafka;
let producer;
let producerReady = false;

function client() {
  if (!kafka) {
    kafka = new Kafka({
      clientId: "m3-conductor-fallback",
      brokers: (process.env.KAFKA_BROKERS || "localhost:9092").split(","),
      logLevel: logLevel.NOTHING,
      connectionTimeout: 5000,
      retry: { retries: 5, initialRetryTime: 300 }
    });
  }
  return kafka;
}

async function publish(envelope) {
  if (!producer) {
    producer = client().producer();
  }
  if (!producerReady) {
    await producer.connect();
    producerReady = true;
  }

  await producer.send({
    topic: TOPIC,
    messages: [{
      key: envelope.routingKey,
      value: JSON.stringify(envelope)
    }]
  });
}

async function disconnectProducer() {
  if (!producer) return;
  try {
    await producer.disconnect();
  } catch (error) {
    console.warn(`[Kafka] Error al desconectar el producer: ${error.message}`);
  }
  producer = null;
  producerReady = false;
}

async function drain(republish) {
  const consumer = client().consumer({ groupId: GROUP });
  await consumer.connect();
  await consumer.subscribe({ topic: TOPIC, fromBeginning: true });

  let idle;
  let finish;
  const quiet = new Promise((resolve) => {
    finish = resolve;
    idle = setTimeout(resolve, 8000);
  });
  const limit = setTimeout(finish, 20000);

  const running = consumer.run({
    eachMessage: async ({ message }) => {
      clearTimeout(idle);
      idle = setTimeout(finish, 1500);
      if (!message.value) return;
      const envelope = JSON.parse(message.value.toString());
      await republish(envelope);
    }
  });

  await quiet;
  clearTimeout(limit);
  clearTimeout(idle);

  try {
    await consumer.disconnect();
  } catch (error) {
    console.warn(`[Kafka] Error al desconectar el consumer: ${error.message}`);
  }
  await running.catch((error) => {
    console.warn(`[Kafka] El consumer de respaldo terminó con error: ${error.message}`);
  });
  await disconnectProducer();
}

module.exports = {
  TOPIC,
  publish,
  drain,
  disconnectProducer
};
