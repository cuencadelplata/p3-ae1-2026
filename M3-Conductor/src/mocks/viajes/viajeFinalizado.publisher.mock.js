const amqp = require("amqplib");
const crypto = require("crypto");

const EXCHANGE =
  "viajes.events";

const ROUTING_KEY =
  "viaje.finalizado";

async function publicarViajeFinalizadoMock() {

  const rabbitUrl =
    process.env.RABBITMQ_URL ||
    "amqp://admin:admin123@localhost:5672";

  const connection =
    await amqp.connect(rabbitUrl);

  const channel =
    await connection.createChannel();

  await channel.assertExchange(
    EXCHANGE,
    "topic",
    {
      durable: true
    }
  );

  const evento = {
    eventId:
      crypto.randomUUID(),

    eventType:
      "viaje.finalizado",

    occurredAt:
      new Date().toISOString(),

    data: {
      viajeId:
        "viaje-001",

      conductorId:
        "conductor-001",

      clienteId:
        "cliente-001",

      finalizadoAt:
        new Date().toISOString()
    }
  };

  channel.publish(
    EXCHANGE,
    ROUTING_KEY,
    Buffer.from(
      JSON.stringify(evento)
    ),
    {
      persistent: true,
      contentType:
        "application/json"
    }
  );

  console.log(
    "[MOCK VIAJES] Evento publicado:",
    evento
  );

  setTimeout(
    async () => {
      await channel.close();
      await connection.close();
    },
    500
  );
}

publicarViajeFinalizadoMock()
  .catch(console.error);