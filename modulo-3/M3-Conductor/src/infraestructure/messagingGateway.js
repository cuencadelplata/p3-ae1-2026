const { connectRabbitMQ, probeRabbitMQ } = require("./rabbimq.client");
const { createCircuitBreaker } = require("./circuitBreaker");
const kafkaFallback = require("./kafkaFallback");
const kafkaLifecycle = require("./kafkaLifecycle");
const kafkaEnabled = process.env.KAFKA_FALLBACK_ENABLED !== "false";

const breaker = createCircuitBreaker({
  failureThreshold: Number(process.env.CIRCUIT_FAILURE_THRESHOLD || 2),
  successThreshold: Number(process.env.CIRCUIT_SUCCESS_THRESHOLD || 2)
});

let onRabbitReady = null;
let recovering = false;
let kafkaStarted = false;
let timer = null;

function status() {
  const circuit = breaker.state();
  return {
    circuit,
    rabbitmq: circuit === "CLOSED" ? "up" : "down",
    fallback: kafkaEnabled && (circuit !== "CLOSED" || recovering) ? "kafka" : "off"
  };
}

async function ensureKafka() {
  if (kafkaStarted) return;
  const started = await kafkaLifecycle.startKafka();
  kafkaStarted = started;
  if (started) {
    await new Promise((resolve) => setTimeout(resolve, 8000));
  }
}

async function republishToRabbit(envelope) {
  const channel = await connectRabbitMQ();
  await channel.assertExchange(envelope.exchange, "topic", { durable: true });
  const body = Buffer.from(envelope.content, "utf8");
  const accepted = channel.publish(
    envelope.exchange,
    envelope.routingKey,
    body,
    envelope.options
  );
  if (!accepted) {
    throw new Error(`RabbitMQ no aceptó ${envelope.routingKey}`);
  }
  await channel.waitForConfirms();
}

async function recover() {
  if (recovering) return;
  recovering = true;
  try {
    if (onRabbitReady) {
      await onRabbitReady();
    }
    if (!kafkaEnabled) {
      console.log("[Circuit] RabbitMQ respondió. El circuito volvió a RabbitMQ.");
      return;
    }
    console.log("[Circuit] RabbitMQ respondió. Drenando la cola temporal de Kafka.");
    await kafkaFallback.drain(republishToRabbit);
    await kafkaLifecycle.stopKafka();
    kafkaStarted = false;
    console.log("[Circuit] Kafka apagado. El circuito volvió a RabbitMQ.");
  } catch (error) {
    console.error(`[Circuit] No se pudo volver a RabbitMQ: ${error.message}`);
    breaker.open();
  } finally {
    recovering = false;
  }
}

breaker.onChange((previous, current) => {
  console.warn(`[Circuit] ${previous} -> ${current}`);
  if (current === "OPEN" && kafkaEnabled) {
    ensureKafka().catch((error) => {
      console.error(`[Kafka] No quedó disponible como respaldo: ${error.message}`);
    });
  }
  if (current === "CLOSED" && previous !== "CLOSED") {
    recover().catch((error) => {
      console.error(`[Circuit] Recuperación fallida: ${error.message}`);
    });
  }
});

async function publish({ exchange, routingKey, content, options, prepare }) {
  const body = Buffer.isBuffer(content) ? content : Buffer.from(String(content));
  const publishOptions = options || {
    persistent: true,
    contentType: "application/json"
  };

  if (breaker.allowsRabbit()) {
    try {
      const channel = await connectRabbitMQ();
      if (prepare) {
        await prepare(channel);
      }
      channel.publish(exchange, routingKey, body, publishOptions);
      await channel.waitForConfirms();
      breaker.recordSuccess();
      return "rabbitmq";
    } catch (error) {
      console.error(`[Circuit] RabbitMQ no aceptó ${routingKey}: ${error.message}`);
      breaker.recordFailure();
      if (!kafkaEnabled) throw error;
    }
  }

  if (!kafkaEnabled) throw new Error("RabbitMQ no está disponible y el respaldo Kafka está desactivado.");

  await ensureKafka();
  await kafkaFallback.publish({
    exchange,
    routingKey,
    content: body.toString("utf8"),
    options: publishOptions
  });
  console.warn(`[Circuit] ${routingKey} quedó en Kafka (${kafkaFallback.TOPIC})`);
  return "kafka";
}

async function tick() {
  if (recovering) return;
  const up = await probeRabbitMQ();
  if (up) {
    breaker.recordSuccess();
    if (breaker.state() === "CLOSED" && onRabbitReady && !recovering) {
      await onRabbitReady();
    }
  } else {
    breaker.recordFailure();
  }
}

function start(hooks = {}) {
  onRabbitReady = hooks.onRabbitReady || null;
  if (timer) return;

  probeRabbitMQ().then((up) => {
    if (up) {
      if (kafkaEnabled) kafkaLifecycle.stopKafka().catch(() => {});
      if (onRabbitReady) {
        return onRabbitReady();
      }
      return null;
    }
    breaker.open();
    return null;
  }).catch((error) => {
    console.error(`[Circuit] Health check inicial falló: ${error.message}`);
    breaker.open();
  });

  const intervalMs = Number(process.env.RABBITMQ_HEALTH_INTERVAL_MS || 5000);
  timer = setInterval(() => {
    tick().catch((error) => {
      console.error(`[Circuit] Health check falló: ${error.message}`);
    });
  }, intervalMs);
  timer.unref();
}

module.exports = {
  publish,
  start,
  status
};
