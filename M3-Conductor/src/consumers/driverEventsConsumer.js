/**
 * Consumidor de ejemplo de los eventos del Módulo 3 (RNF-07).
 *
 * Simula lo que haría un módulo suscriptor (ej. M5 - matching de viajes):
 * declara su PROPIA cola durable, la bindea al exchange topic de M3 con las
 * routing keys que le interesan y procesa los mensajes con ack manual.
 *
 * Ejecutar con:  npm run consumer
 */
const amqp = require("amqplib");
require("dotenv").config();

const { EVENTOS } = require("../events/driverEvents");

const RABBITMQ_URL = process.env.RABBITMQ_URL || "amqp://admin:admin123@localhost:5672";
const EXCHANGE = process.env.RABBITMQ_EXCHANGE || "m3.conductores.events";
const QUEUE = process.env.RABBITMQ_EXAMPLE_QUEUE || "m3.ejemplo.driver-events";
// "driver.#" recibe todos los eventos de conductor; un módulo real podría
// bindear sólo "driver.availability.*" si no le interesa la habilitación.
const BINDING_KEYS = ["driver.#"];

const handlers = {
  [EVENTOS.DRIVER_AVAILABILITY_UPDATED.tipo]: (evento) => {
    const { usuarioID, disponible, disponibleAnterior } = evento.data;
    console.log(
      `  ➜ Conductor ${usuarioID} pasó de ${disponibleAnterior ? "DISPONIBLE" : "NO disponible"} a ${disponible ? "DISPONIBLE" : "NO disponible"}`
    );
  },
  [EVENTOS.DRIVER_STATUS_CHANGED.tipo]: (evento) => {
    const { usuarioID, habilitado, habilitadoAnterior, motivo } = evento.data;
    console.log(
      `  ➜ Conductor ${usuarioID} cambió su habilitación: '${habilitadoAnterior}' → '${habilitado}'${motivo ? ` (motivo: ${motivo})` : ""}`
    );
  }
};

async function iniciar() {
  const connection = await amqp.connect(RABBITMQ_URL);
  const channel = await connection.createChannel();

  await channel.assertExchange(EXCHANGE, "topic", { durable: true });
  await channel.assertQueue(QUEUE, { durable: true });
  for (const key of BINDING_KEYS) {
    await channel.bindQueue(QUEUE, EXCHANGE, key);
  }
  // Procesar de a un mensaje por vez hasta confirmarlo
  await channel.prefetch(1);

  console.log(`[Consumer] Escuchando cola '${QUEUE}' (exchange '${EXCHANGE}', keys ${BINDING_KEYS.join(", ")})`);

  await channel.consume(QUEUE, (msg) => {
    if (!msg) return;

    try {
      const evento = JSON.parse(msg.content.toString());
      console.log(`[Consumer] ${evento.eventType} id=${evento.eventId} (${msg.fields.routingKey}) @ ${evento.occurredAt}`);

      const handler = handlers[evento.eventType];
      if (handler) {
        handler(evento);
      } else {
        console.warn(`[Consumer] Evento sin handler, se descarta: ${evento.eventType}`);
      }
      channel.ack(msg);
    } catch (err) {
      // Mensaje malformado: se rechaza sin reencolar para no entrar en loop
      console.error(`[Consumer] Error procesando mensaje: ${err.message}`);
      channel.nack(msg, false, false);
    }
  });

  const cerrar = async () => {
    console.log("[Consumer] Cerrando conexión...");
    await connection.close().catch(() => {});
    process.exit(0);
  };
  process.on("SIGINT", cerrar);
  process.on("SIGTERM", cerrar);
}

iniciar().catch((err) => {
  console.error(`[Consumer] No se pudo iniciar: ${err.message}`);
  process.exit(1);
});
