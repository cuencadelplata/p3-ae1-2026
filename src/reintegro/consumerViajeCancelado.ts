import type { ConsumeMessage, Channel } from "amqplib";
import { config } from "../config";
import { QUEUE_CANCELADO } from "../infraestructura/rabbit";
import { ErrorPermanente } from "./obtenerCargo";
import { procesarReintegro, type EventoCancelacionM6 } from "./procesarReintegro";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function parsear(msg: ConsumeMessage): EventoCancelacionM6 {
  let ev: EventoCancelacionM6;
  try {
    ev = JSON.parse(msg.content.toString());
  } catch {
    throw new ErrorPermanente("JSON inválido");
  }
  if (!ev.viajeId || !ev.evento) {
    throw new ErrorPermanente("Evento de cancelación incompleto (falta viajeId o evento)");
  }
  if (ev.evento !== "cancelacion_cliente" && ev.evento !== "despacho.reabrir") {
    throw new ErrorPermanente(`routing key/evento desconocido: ${ev.evento}`);
  }
  return ev;
}

export async function iniciarConsumerViajeCancelado(ch: Channel): Promise<void> {
  await ch.consume(QUEUE_CANCELADO, async (msg) => {
    if (!msg) return;
    const intentos = Number(msg.properties.headers?.["x-intentos"] ?? 0);

    try {
      const ev = parsear(msg);
      const resultado = await procesarReintegro(ev);
      console.log(JSON.stringify({ evento: ev.evento, viajeId: ev.viajeId, resultado }));
      ch.ack(msg);
    } catch (e) {
      const error = e as Error;
      if (e instanceof ErrorPermanente || intentos + 1 >= config.maxIntentos) {
        console.error(`[consumer] a DLQ: ${error.message}`);
        ch.nack(msg, false, false);
        return;
      }
      await sleep(1000 * 2 ** intentos);
      ch.sendToQueue(QUEUE_CANCELADO, msg.content, {
        persistent: true,
        headers: { ...msg.properties.headers, "x-intentos": intentos + 1 },
      });
      ch.ack(msg);
    }
  });
}
