import amqp, { Channel } from "amqplib";

const rabbitUrl =
    process.env.RABBITMQ_URL ||
    "amqp://guest:guest@localhost:5672";

// Exchange propio de M1: cada módulo tiene su RabbitMQ y publica en su exchange.
export const EXCHANGE_M1 = "m1.eventos";

// Si la conexión falla, se espera este tiempo antes de volver a intentar.
const ESPERA_REINTENTO_MS = 10_000;

let canal: Channel | null = null;
let conectando: Promise<Channel> | null = null;
let ultimoFallo = 0;

async function conectar(): Promise<Channel> {
    const conexion = await amqp.connect(rabbitUrl);

    conexion.on("error", (error) => {
        console.error("[RabbitMQ] Error en la conexión:", error.message);
    });

    conexion.on("close", () => {
        // Si RabbitMQ se cae, se descarta el canal y se reconecta en el próximo evento.
        canal = null;
    });

    const nuevoCanal = await conexion.createChannel();

    await nuevoCanal.assertExchange(EXCHANGE_M1, "topic", {
        durable: true
    });

    return nuevoCanal;
}

export async function obtenerCanal(): Promise<Channel> {
    if (canal) {
        return canal;
    }

    if (Date.now() - ultimoFallo < ESPERA_REINTENTO_MS) {
        throw new Error("RabbitMQ no disponible, se reintentará más tarde");
    }

    if (!conectando) {
        conectando = conectar()
            .then((nuevoCanal) => {
                canal = nuevoCanal;
                return nuevoCanal;
            })
            .catch((error) => {
                ultimoFallo = Date.now();
                throw error;
            })
            .finally(() => {
                conectando = null;
            });
    }

    return conectando;
}
