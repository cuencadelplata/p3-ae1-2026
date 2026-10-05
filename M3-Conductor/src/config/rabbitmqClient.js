const amqp = require("amqplib");
require("dotenv").config();

const RABBITMQ_URL = process.env.RABBITMQ_URL || "amqp://guest:guest@localhost:5672";
// Exchange de tipo "topic" donde M3 publica todos sus eventos de dominio. Los
// módulos interesados (ej. M5 matching) crean su propia cola y la bindean con
// la routing key que les interese (ver docs/EVENTOS.md).
const EXCHANGE = process.env.RABBITMQ_EXCHANGE || "m3.conductores.events";

let connection = null;
let channel = null;
let conectando = null;

function resetear() {
  connection = null;
  channel = null;
  conectando = null;
}

/**
 * Devuelve un ConfirmChannel listo para usar, abriendo la conexión de forma
 * perezosa la primera vez. Si la conexión se cae, se descarta y el próximo
 * llamado vuelve a intentar conectar (no se bloquea el arranque del servidor
 * si RabbitMQ todavía no está disponible).
 */
async function getChannel() {
  if (channel) return channel;
  if (conectando) return conectando;

  conectando = (async () => {
    try {
      connection = await amqp.connect(RABBITMQ_URL);
      connection.on("error", (err) => console.error(`[RabbitMQ] Error de conexión: ${err.message}`));
      connection.on("close", () => {
        console.warn("[RabbitMQ] Conexión cerrada, se reintentará en la próxima publicación.");
        resetear();
      });

      const ch = await connection.createConfirmChannel();
      ch.on("error", (err) => console.error(`[RabbitMQ] Error de canal: ${err.message}`));
      ch.on("close", () => {
        channel = null;
      });

      await ch.assertExchange(EXCHANGE, "topic", { durable: true });

      console.log(`[RabbitMQ] Conectado a ${RABBITMQ_URL.replace(/\/\/.*@/, "//***@")} (exchange '${EXCHANGE}')`);
      channel = ch;
      return ch;
    } catch (err) {
      resetear();
      throw err;
    }
  })();

  return conectando;
}

async function cerrar() {
  try {
    if (connection) await connection.close();
  } catch (_err) {
    // Ignorado: la conexión ya podía estar cerrada
  }
  resetear();
}

module.exports = {
  getChannel,
  cerrar,
  EXCHANGE,
  RABBITMQ_URL
};
