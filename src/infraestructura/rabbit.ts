import amqp from "amqplib";
import type { Channel, ChannelModel } from "amqplib";
import { config } from "../config";
import { iniciarConsumerViajeCancelado } from "../6-reintegro/consumerViajeCancelado";

export const EXCHANGE_VIAJES = "viajes";
export const EXCHANGE_M7 = "m7.eventos";
export const EXCHANGE_DLX = "m7.dlx";
export const QUEUE_CANCELADO = "m7.reintegro.viaje-cancelado";
export const QUEUE_DLQ = "m7.reintegro.viaje-cancelado.dlq";

// Routing keys reales que publica M6 (Lucas). No usan "viaje.cancelado".
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

// Conecta, arma la topología y deja el consumer escuchando.
// Si la conexión se corta después (broker reiniciado, red caída), reintenta solo.
export async function iniciarRabbit(): Promise<void> {
  if (conectando) return;
  conectando = true;

  let conexion: ChannelModel;
  try {
    conexion = await amqp.connect(config.rabbitUrl);
  } catch (e) {
    conectando = false;
    console.error(`[rabbit] no se pudo conectar: ${(e as Error).message}. Reintento en ${REINTENTO_MS / 1000}s`);
    setTimeout(iniciarRabbit, REINTENTO_MS);
    return;
  }

  conexion.on("close", () => {
    console.error("[rabbit] conexión cerrada, reconectando...");
    canal = undefined;
    conectando = false;
    setTimeout(iniciarRabbit, REINTENTO_MS);
  });
  conexion.on("error", (e) => console.error("[rabbit] error:", e.message));

  try {
    const ch = await conexion.createChannel();
    await armarTopologia(ch);
    await iniciarConsumerViajeCancelado(ch);

    canal = ch;
    conectando = false;
    console.log("[rabbit] conectado y escuchando viaje.cancelado");
  } catch (e) {
    conectando = false;
    console.error(`[rabbit] fallo armando topología/consumer: ${(e as Error).message}. Reintento en ${REINTENTO_MS / 1000}s`);
    setTimeout(iniciarRabbit, REINTENTO_MS);
  }
}

export function publicar(routingKey: string, payload: object, messageId: string): void {
  if (!canal) {
    console.error(`[rabbit] sin canal activo, no se pudo publicar ${routingKey} (${messageId})`);
    return;
  }
  canal.publish(EXCHANGE_M7, routingKey, Buffer.from(JSON.stringify(payload)), {
    persistent: true,
    contentType: "application/json",
    messageId,
  });
}