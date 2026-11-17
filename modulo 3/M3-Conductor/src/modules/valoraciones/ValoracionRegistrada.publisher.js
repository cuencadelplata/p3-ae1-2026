const crypto = require("crypto");
const gateway = require("../../infraestructure/messagingGateway");
const topology = require("../../infraestructure/rabbitmq.topology");

/**
 * Publica valoracion.registrada tras un POST /conductor/valoraciones exitoso.
 * No lanza: si RabbitMQ falla se loguea y se devuelve false para no romper el HTTP.
 *
 * @returns {Promise<boolean>}
 */
async function publicarValoracionRegistrada(valoracion) {
  const evento = {
    eventId: crypto.randomUUID(),
    eventType: "valoracion.registrada",
    eventVersion: 1,
    source: "M3-Conductor",
    occurredAt: new Date().toISOString(),
    data: {
      id: valoracion.id,
      evaluadorId: valoracion.evaluadorId,
      evaluadoId: valoracion.evaluadoId,
      valoracion: valoracion.valoracion,
      comentario: valoracion.comentario || "",
      viajeId: valoracion.viajeId || null,
      fecha: valoracion.fecha || new Date().toISOString(),
      estado: "REGISTRADA"
    }
  };

  try {
    const exchange = topology.exchanges.VALORACIONES;
    const routingKey = topology.routingKeys.VALORACION_REGISTRADA;

    const broker = await gateway.publish({
      exchange,
      routingKey,
      content: Buffer.from(JSON.stringify(evento)),
      options: {
        persistent: true,
        contentType: "application/json",
        messageId: evento.eventId,
        type: evento.eventType,
        timestamp: Math.floor(Date.parse(evento.occurredAt) / 1000),
        appId: evento.source
      },
      prepare: async (channel) => {
        await channel.assertExchange(exchange, "topic", { durable: true });
      }
    });

    console.log(
      `[${broker}] Evento publicado ${evento.eventType} (${routingKey}) id=${evento.eventId}`
    );
    return true;
  } catch (err) {
    console.error(
      `[RabbitMQ] No se pudo publicar valoracion.registrada: ${err.message}`
    );
    return false;
  }
}

module.exports = { publicarValoracionRegistrada };
