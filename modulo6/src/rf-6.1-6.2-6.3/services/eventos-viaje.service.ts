import amqp, { type ChannelModel, type ConfirmChannel } from 'amqplib';
import { randomUUID } from 'node:crypto';
import pool from '../db/pool.js';

// RF-6.4: eventos que M6 emite al finalizar un viaje.
// Cada consumidor acordó un exchange y un formato propios, por eso el mismo hecho
// se publica una vez por consumidor. Todos se escriben en el outbox dentro de la
// misma transacción que completa el viaje, así un fallo de RabbitMQ no los pierde.

export interface EventoSalida {
    messageId: string;
    exchange: string;
    routingKey: string;
    payload: Record<string, unknown>;
}

export interface DatosViajeFinalizado {
    viajeId: string;
    clienteId: string;
    conductorId: string | null;
    finalizadoAt: Date;
    total: number;
    paymentId: string;
}

export const EXCHANGE_M8 = 'mobility.events';
export const EXCHANGE_M3 = 'viajes.events';
export const EXCHANGE_M4 = 'trip.events';
const PRODUCER = 'm6-viajes';

/** M4 y M8 identifican a las personas con el userId numérico de M1. */
export function idUsuarioNumerico(value: string | null | undefined): number | undefined {
    if (!value || !/^\d+$/.test(value)) return undefined;
    const id = Number(value);
    return Number.isSafeInteger(id) && id > 0 ? id : undefined;
}

export function eventosViajeFinalizado(datos: DatosViajeFinalizado): EventoSalida[] {
    const occurredAt = datos.finalizadoAt.toISOString();
    const eventos: EventoSalida[] = [];

    // M3 (valoraciones): viaje.finalizado en viajes.events
    if (datos.conductorId) {
        const messageId = randomUUID();
        eventos.push({
            messageId,
            exchange: EXCHANGE_M3,
            routingKey: 'viaje.finalizado',
            payload: {
                eventId: messageId,
                eventType: 'viaje.finalizado',
                occurredAt,
                data: {
                    viajeId: datos.viajeId,
                    conductorId: datos.conductorId,
                    clienteId: datos.clienteId,
                    finalizadoAt: occurredAt,
                },
            },
        });
    }

    // M8 (notificaciones): TripCompleted con el sobre común de mobility.events
    const recipientId = idUsuarioNumerico(datos.clienteId);
    if (recipientId !== undefined) {
        const messageId = randomUUID();
        eventos.push({
            messageId,
            exchange: EXCHANGE_M8,
            routingKey: 'trip.completed',
            payload: {
                messageId,
                eventType: 'TripCompleted',
                version: 1,
                occurredAt,
                correlationId: datos.viajeId,
                producer: PRODUCER,
                data: {
                    tripId: datos.viajeId,
                    recipientId,
                    total: datos.total,
                    paymentId: datos.paymentId,
                },
            },
        });
    }

    // M4 (disponibilidad): libera al conductor
    const driverId = idUsuarioNumerico(datos.conductorId);
    if (driverId !== undefined) {
        const messageId = randomUUID();
        eventos.push({
            messageId,
            exchange: EXCHANGE_M4,
            routingKey: 'viaje.finalizado',
            payload: {
                eventId: messageId,
                eventType: 'viaje.finalizado',
                tripId: datos.viajeId,
                driverId,
                occurredAt,
            },
        });
    }

    return eventos;
}

const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://localhost:5672';
let conexion: ChannelModel | undefined;
let canal: ConfirmChannel | undefined;
let despachando: Promise<number> | undefined;

async function obtenerCanal(): Promise<ConfirmChannel> {
    if (canal) return canal;
    const nuevaConexion = await amqp.connect(RABBITMQ_URL);
    const nuevoCanal = await nuevaConexion.createConfirmChannel();
    const reiniciar = () => {
        conexion = undefined;
        canal = undefined;
    };
    nuevaConexion.on('close', reiniciar);
    nuevaConexion.on('error', reiniciar);
    for (const exchange of [EXCHANGE_M3, EXCHANGE_M4, EXCHANGE_M8]) {
        await nuevoCanal.assertExchange(exchange, 'topic', { durable: true });
    }
    conexion = nuevaConexion;
    canal = nuevoCanal;
    return nuevoCanal;
}

async function publicar(evento: EventoSalida): Promise<void> {
    const ch = await obtenerCanal();
    await new Promise<void>((resolve, reject) => {
        ch.publish(
            evento.exchange,
            evento.routingKey,
            Buffer.from(JSON.stringify(evento.payload)),
            {
                contentType: 'application/json',
                persistent: true,
                messageId: evento.messageId,
            },
            (error) => (error ? reject(error) : resolve()),
        );
    });
}

/**
 * Publica los eventos pendientes del outbox y los marca como publicados.
 * Es seguro llamarla en paralelo: las ejecuciones se encadenan.
 */
export function despacharEventosPendientes(limite = 50): Promise<number> {
    despachando ??= (async () => {
        let publicados = 0;
        try {
            const { rows } = await pool.query(
                `SELECT message_id, exchange, routing_key, payload
                 FROM viaje_eventos_outbox
                 WHERE publicado_at IS NULL
                 ORDER BY creado_at, message_id
                 LIMIT $1`,
                [limite],
            );
            for (const row of rows) {
                await publicar({
                    messageId: row.message_id,
                    exchange: row.exchange,
                    routingKey: row.routing_key,
                    payload: row.payload,
                });
                await pool.query(
                    'UPDATE viaje_eventos_outbox SET publicado_at = now() WHERE message_id = $1',
                    [row.message_id],
                );
                publicados += 1;
            }
        } catch (error) {
            // 42P01: el outbox todavía no se creó (ningún viaje se finalizó desde el arranque)
            if ((error as { code?: string }).code !== '42P01') {
                console.error('[Outbox] No se pudieron publicar eventos pendientes:', error instanceof Error ? error.message : error);
            }
        } finally {
            despachando = undefined;
        }
        return publicados;
    })();
    return despachando;
}

export async function cerrarPublicador(): Promise<void> {
    try {
        await canal?.close();
        await conexion?.close();
    } catch {
        // la conexión ya estaba cerrada
    }
    canal = undefined;
    conexion = undefined;
}
