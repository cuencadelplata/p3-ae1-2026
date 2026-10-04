import amqp from "amqplib";
import type { Channel, ChannelModel } from "amqplib";
import { config } from "../config";
import { iniciarConsumerViajeCancelado } from "../reintegro/consumerViajeCancelado";

export const EXCHANGE_VIAJES = "viajes";
export const EXCHANGE_M7 = "m7.eventos";
export const EXCHANGE_DLX = "m7.dlx";
export const QUEUE_CANCELADO = "m7.reintegro.viaje-cancelado";
export const QUEUE_DLQ = "m7.reintegro.viaje-cancelado.dlq";

const ROUTING_KEYS_M6 = ["cancelacion_cliente", "despacho.reabrir"];
const REINTENTO_MS = 5000;

let canal: Channel | undefined;
let conectando = false;

async function armarTopologia(ch: Channel): Promise<void> {
  await ch.assertExchange(EXCHANGE_VIAJES, "topic", { durable: true });
  await ch.assertExchange(EXCHANGE_M7, "topic", { durable: true });
  await ch.assertExchange(EXCHANGE_DLX, "direct", { durable: true });

  await ch.assertQueue(QUEUE_DLQ, { durable: true });
  await ch.bindQueue(QUEUE_DLQ, EXCHANGE_DLX, QUEUE_CANCELADO);

  await ch.assertQueue(QUEUE_CANCELADO, {
    durable: true,
    arguments: {
      "x-dead-letter-exchange": EXCHANGE_DLX,
      "x-dead-letter-routing-key": QUEUE_CANCELADO,
    },
  });

  for (const rk of ROUTING_KEYS_M6) {
    await ch.bindQueue(QUEUE_CANCELADO, EXCHANGE_VIAJES, rk);
  }

  await ch.prefetch(5);
}

export async function iniciarRabbit(): Promise<void> {
  if (conectando) return;
  conectando = true;

  let conexion: ChannelModel;
  try {
    conexion = await amqp.connect(config.rabbitUrl);
  } catch (e) {
    conectando = false;
    console.warn(`[rabbit] No se pudo conectar a RabbitMQ: ${(e as Error).message}. Próximo reintento en ${REINTENTO_MS / 1000}s`);
    setTimeout(iniciarRabbit, REINTENTO_MS);
    return;
  }

  conexion.on("close", () => {
    console.warn("[rabbit] Conexión cerrada. Reconectando cuando el servicio vuelva a estar disponible...");
    canal = undefined;
    conectando = false;
    setTimeout(iniciarRabbit, REINTENTO_MS);
  });

  conexion.on("error", (e) => {
    console.warn("[rabbit] Evento de error:", e.message);
  });

  try {
    const ch = await conexion.createChannel();
    await armarTopologia(ch);
    await iniciarConsumerViajeCancelado(ch);

    canal = ch;
    conectando = false;
    console.log("[rabbit] Conectado exitosamente y escuchando eventos en RabbitMQ.");
  } catch (e) {
    conectando = false;
    console.error(`[rabbit] Error al configurar topología o consumidor: ${(e as Error).message}. Reintento en ${REINTENTO_MS / 1000}s`);
    setTimeout(iniciarRabbit, REINTENTO_MS);
  }
}

export function publicar(routingKey: string, payload: object, messageId: string): void {
  if (!canal) {
    console.warn(`[rabbit] Sin canal activo. Mensaje ${messageId} no pudo ser publicado a ${routingKey} (RabbitMQ caído o desconectado).`);
    return;
  }
  try {
    canal.publish(EXCHANGE_M7, routingKey, Buffer.from(JSON.stringify(payload)), {
      persistent: true,
      contentType: "application/json",
      messageId,
    });
  } catch (e) {
    console.error(`[rabbit] Error al publicar mensaje: ${(e as Error).message}`);
  }
}
