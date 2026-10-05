import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Channel } from "amqplib";

vi.mock("../reintegro/procesarReintegro", () => ({ procesarReintegro: vi.fn() }));
vi.mock("../infraestructura/rabbit", () => ({ QUEUE_CANCELADO: "cola.test" }));

import { iniciarConsumerViajeCancelado } from "../reintegro/consumerViajeCancelado";
import { procesarReintegro } from "../reintegro/procesarReintegro";
import {
  ErrorPermanente,
  ErrorTransitorio,
} from "../reintegro/obtenerCargo";

// ... el resto igual

const eventoValido = {
  viajeId: "V-1",
  clienteId: "C-1",
  conductorId: "D-1",
  motivo: "tardó demasiado en llegar",
  evento: "cancelacion_cliente",
  timestamp: "2026-09-28T20:10:00Z",
};

const mensaje = (contenido: unknown, headers: Record<string, unknown> = {}) =>
  ({
    content: Buffer.from(
      typeof contenido === "string" ? contenido : JSON.stringify(contenido)
    ),
    properties: { headers },
  }) as any;

async function armarConsumer() {
  const ch = {
    consume: vi.fn(),
    ack: vi.fn(),
    nack: vi.fn(),
    sendToQueue: vi.fn(),
  };
  await iniciarConsumerViajeCancelado(ch as unknown as Channel);
  const handler = ch.consume.mock.calls[0]![1] as (m: any) => Promise<void>;
  return { ch, handler };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
});

// Caso 5: prueba que el consumer se suscribe bien. Lo de reintentar al arrancar se prueba con Docker, no en el test
describe("consumer de viaje.cancelado", () => {
  it("se suscribe a la cola configurada", async () => {
    const { ch } = await armarConsumer();

    expect(ch.consume).toHaveBeenCalledWith("cola.test", expect.any(Function));
  });

  it("procesa el evento y hace ack", async () => {
    vi.mocked(procesarReintegro).mockResolvedValue("procesado");
    const { ch, handler } = await armarConsumer();
    const msg = mensaje(eventoValido);

    await handler(msg);

    expect(procesarReintegro).toHaveBeenCalledWith(eventoValido);
    expect(ch.ack).toHaveBeenCalledWith(msg);
    expect(ch.nack).not.toHaveBeenCalled();
  });

  it("un duplicado también se confirma (ack): no se reintenta", async () => {
    vi.mocked(procesarReintegro).mockResolvedValue("duplicado");
    const { ch, handler } = await armarConsumer();

    await handler(mensaje(eventoValido));

    expect(ch.ack).toHaveBeenCalledTimes(1);
    expect(ch.sendToQueue).not.toHaveBeenCalled();
  });

  // Caso 9: mensaje inválido → va directo a la DLQ, sin reintentos

  it("caso 9a: JSON inválido va directo a la DLQ (nack sin requeue)", async () => {
    const { ch, handler } = await armarConsumer();
    const msg = mensaje("esto no es json");

    await handler(msg);

    expect(procesarReintegro).not.toHaveBeenCalled();
    expect(ch.nack).toHaveBeenCalledWith(msg, false, false);
    expect(ch.ack).not.toHaveBeenCalled();
  });

  it("caso 9b: evento sin viajeId ni evento (campos obligatorios) va directo a la DLQ", async () => {
    const { ch, handler } = await armarConsumer();
    const msg = mensaje({ hola: "mundo" });

    await handler(msg);

    expect(procesarReintegro).not.toHaveBeenCalled();
    expect(ch.nack).toHaveBeenCalledWith(msg, false, false);
  });

  it("caso 9c: routing key/evento desconocido (ni cliente ni conductor) va a la DLQ", async () => {
    const { ch, handler } = await armarConsumer();
    const msg = mensaje({ ...eventoValido, evento: "algo.raro" });

    await handler(msg);

    expect(procesarReintegro).not.toHaveBeenCalled();
    expect(ch.nack).toHaveBeenCalledWith(msg, false, false);
  });

  // Caso 10: si RF-7.4 falla, reintenta unas veces; si sigue mal, va a una cola de mensajes muertos (DLQ)

  it("caso 10a: error permanente (RF-7.4 devolvió 4xx) va a la DLQ sin reintentos", async () => {
    vi.mocked(procesarReintegro).mockRejectedValue(new ErrorPermanente("rechazado"));
    const { ch, handler } = await armarConsumer();
    const msg = mensaje(eventoValido);

    await handler(msg);

    expect(ch.nack).toHaveBeenCalledWith(msg, false, false);
    expect(ch.sendToQueue).not.toHaveBeenCalled();
  });

  it("caso 10b: error transitorio (RF-7.4 no responde): espera, reintenta con contador, y hace ack del original", async () => {
    vi.mocked(procesarReintegro).mockRejectedValue(new ErrorTransitorio("caído"));
    const { ch, handler } = await armarConsumer();
    const msg = mensaje(eventoValido);

    const promesa = handler(msg);
    await vi.advanceTimersByTimeAsync(1000);
    await promesa;

    expect(ch.sendToQueue).toHaveBeenCalledWith(
      "cola.test",
      msg.content,
      expect.objectContaining({
        persistent: true,
        headers: expect.objectContaining({ "x-intentos": 1 }),
      })
    );
    expect(ch.ack).toHaveBeenCalledWith(msg);
    expect(ch.nack).not.toHaveBeenCalled();
  });

  it("caso 10c: error transitorio en el último intento permitido va a la DLQ (se agotaron los reintentos)", async () => {
    vi.mocked(procesarReintegro).mockRejectedValue(new ErrorTransitorio("caído"));
    const { ch, handler } = await armarConsumer();
    const msg = mensaje(eventoValido, { "x-intentos": 2 }); // MAX_INTENTOS = 3

    await handler(msg);

    expect(ch.nack).toHaveBeenCalledWith(msg, false, false);
    expect(ch.sendToQueue).not.toHaveBeenCalled();
  });

  // Caso 13: si falla la base, el código lo trata igual que si fallara RF-7.4 (reintenta)

  it("caso 13: si la base falla con un error genérico, se trata como transitorio y reintenta", async () => {
    vi.mocked(procesarReintegro).mockRejectedValue(new Error("Postgres: connection refused"));
    const { ch, handler } = await armarConsumer();
    const msg = mensaje(eventoValido);

    const promesa = handler(msg);
    await vi.advanceTimersByTimeAsync(1000);
    await promesa;

    expect(ch.sendToQueue).toHaveBeenCalled(); // reintenta, no descarta directo
    expect(ch.nack).not.toHaveBeenCalled();
  });
});