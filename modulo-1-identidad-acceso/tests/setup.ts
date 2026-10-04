import { vi } from "vitest";

// Redis falso en memoria: los tests no necesitan un Redis real.
vi.mock("ioredis", async () => {
    const RedisMock = (await import("ioredis-mock")).default;

    return { default: RedisMock };
});

// RabbitMQ falso: guarda los mensajes publicados en una lista para revisarlos en los tests.
vi.mock("amqplib", () => {
    const mensajes: { routingKey: string; contenido: any }[] = [];

    (globalThis as any).__mensajesRabbit = mensajes;

    const canal = {
        assertExchange: async () => ({}),
        publish: (
            _exchange: string,
            routingKey: string,
            contenido: Buffer
        ) => {
            mensajes.push({
                routingKey,
                contenido: JSON.parse(contenido.toString())
            });
            return true;
        }
    };

    const conexion = {
        on: () => {},
        createChannel: async () => canal
    };

    return {
        default: {
            connect: async () => conexion
        }
    };
});
