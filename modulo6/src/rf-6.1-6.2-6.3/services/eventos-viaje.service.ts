import { context, propagation } from '@opentelemetry/api';
import amqp, { type ChannelModel, type ConfirmChannel } from 'amqplib';
import { randomUUID } from 'node:crypto';
import pool from '../db/pool.js';
import { conContexto, logger } from '../../observabilidad/logger.js';
import { erroresPublicacion, eventosPublicados } from '../../observabilidad/metricas.js';

/** traceparent W3C de la solicitud actual (null si no hay traza activa). */
export function traceparentActual(): string | null {
    const carrier: Record<string, string> = {};
    propagation.inject(context.active(), carrier);
    return carrier.traceparent ?? null;
}

// Eventos de ciclo de vida que M6 publica por outbox (inicio, finalización y cancelación).
// Cada consumidor acordó un exchange y un formato propios, por eso el mismo hecho
// se publica una vez por consumidor. Todos se escriben en el outbox dentro de la
// misma transacción que cambia el estado del viaje, así un fallo de RabbitMQ no los pierde.

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
    /** userId numérico de M1 del cliente, guardado al solicitar el viaje. */
    clientUserId?: number | null;
    /** userId numérico de M1 del conductor, guardado al asignar el viaje. */
    driverUserId?: number | null;
    finalizadoAt: Date;
    total: number;
    paymentId: string;
}

export interface DatosViajeCancelado {
    viajeId: string;
    clienteId: string;
    conductorId: string | null;
    clientUserId?: number | null;
    driverUserId?: number | null;
    canceladoAt: Date;
    cancelledBy: 'cliente' | 'conductor';
    motivo: string;
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

/**
 * userId de M1 a usar en los eventos: el guardado por M6 (clientUserId / driverUserId)
 * y, para viajes anteriores a esas columnas, el id textual si es numérico.
 */
export function idUsuarioM1(guardado: number | null | undefined, textual: string | null | undefined): number | undefined {
    if (typeof guardado === 'number' && Number.isSafeInteger(guardado) && guardado > 0) return guardado;
    return idUsuarioNumerico(textual);
}

export type EventoTrip = 'viaje.iniciado' | 'viaje.finalizado' | 'viaje.cancelado';

/**
 * Contrato con M4 (disponibilidad de conductores):
 *   exchange `trip.events` (topic, durable), routing key = eventType,
 *   cuerpo plano { eventId, eventType, tripId, driverId, occurredAt }.
 * driverId es el userId numérico de M1 del conductor. Sin ese dato no se publica,
 * porque M4 descarta a su DLQ los mensajes sin driverId entero.
 */
export function eventoTripEvents(
    tipo: EventoTrip,
    datos: { viajeId: string; driverUserId?: number | null; conductorId?: string | null; occurredAt: Date },
): EventoSalida | null {
    const driverId = idUsuarioM1(datos.driverUserId, datos.conductorId);
    if (driverId === undefined) return null;
    const messageId = randomUUID();
    return {
        messageId,
        exchange: EXCHANGE_M4,
        routingKey: tipo,
        payload: {
            eventId: messageId,
            eventType: tipo,
            tripId: datos.viajeId,
            driverId,
            occurredAt: datos.occurredAt.toISOString(),
        },
    };
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
    const recipientId = idUsuarioM1(datos.clientUserId, datos.clienteId);
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
    const paraM4 = eventoTripEvents('viaje.finalizado', {
        viajeId: datos.viajeId,
        driverUserId: datos.driverUserId,
        conductorId: datos.conductorId,
        occurredAt: datos.finalizadoAt,
    });
    if (paraM4) eventos.push(paraM4);

    return eventos;
}

/**
 * TripCancelled para M8 (mobility.events, trip.cancelled), con el mismo sobre que TripCompleted.
 * Un evento por destinatario: el cliente y, si había uno asignado, el conductor.
 * Se omite el destinatario que no tiene userId numérico de M1.
 */
export function eventosViajeCancelado(datos: DatosViajeCancelado): EventoSalida[] {
    const occurredAt = datos.canceladoAt.toISOString();
    const destinatarios = [
        idUsuarioM1(datos.clientUserId, datos.clienteId),
        datos.conductorId ? idUsuarioM1(datos.driverUserId, datos.conductorId) : undefined,
    ];

    return destinatarios
        .filter((recipientId): recipientId is number => recipientId !== undefined)
        .map((recipientId) => {
            const messageId = randomUUID();
            return {
                messageId,
                exchange: EXCHANGE_M8,
                routingKey: 'trip.cancelled',
                payload: {
                    messageId,
                    eventType: 'TripCancelled',
                    version: 1,
                    occurredAt,
                    correlationId: datos.viajeId,
                    producer: PRODUCER,
                    data: {
                        tripId: datos.viajeId,
                        recipientId,
                        cancelledBy: datos.cancelledBy,
                        motivo: datos.motivo,
                    },
                },
            };
        });
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
 * Es seguro llamarla en paralelo: dentro de una instancia las ejecuciones se encadenan, y entre
 * instancias (m6-viajes escalado detrás del balanceador) cada evento se toma con
 * FOR UPDATE SKIP LOCKED, así que lo publica una sola instancia.
 */
export function despacharEventosPendientes(limite = 50): Promise<number> {
    despachando ??= (async () => {
        let publicados = 0;
        try {
            while (publicados < limite && await publicarSiguientePendiente()) {
                publicados += 1;
            }
        } catch (error) {
            // 42P01: el outbox todavía no se creó (ningún viaje se finalizó desde el arranque)
            if ((error as { code?: string }).code !== '42P01') {
                erroresPublicacion.inc();
                logger.warn({ err: error }, 'No se pudieron publicar eventos pendientes; se reintentará');
            }
        } finally {
            despachando = undefined;
        }
        return publicados;
    })();
    return despachando;
}

/**
 * Toma el evento pendiente más antiguo que ninguna otra instancia tenga bloqueado, lo publica y lo
 * marca como publicado, todo en una transacción. Devuelve false si no quedaba ninguno libre.
 * Si la publicación falla, el ROLLBACK libera el evento y se reintenta en la próxima pasada.
 */
async function publicarSiguientePendiente(): Promise<boolean> {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { rows } = await client.query(
            `SELECT message_id, viaje_id, exchange, routing_key, payload, traceparent
             FROM viaje_eventos_outbox
             WHERE publicado_at IS NULL
             ORDER BY creado_at, message_id
             LIMIT 1
             FOR UPDATE SKIP LOCKED`,
        );
        const row = rows[0];
        if (!row) {
            await client.query('COMMIT');
            return false;
        }
        // Continúa la traza de la solicitud que originó el evento: la instrumentación de
        // amqplib crea el span de publicación como hijo e inyecta el traceparent en el mensaje.
        const contextoOrigen = row.traceparent
            ? propagation.extract(context.active(), { traceparent: row.traceparent })
            : context.active();
        await context.with(contextoOrigen, () => conContexto(undefined, async () => {
            await publicar({
                messageId: row.message_id,
                exchange: row.exchange,
                routingKey: row.routing_key,
                payload: row.payload,
            });
            await client.query(
                'UPDATE viaje_eventos_outbox SET publicado_at = now() WHERE message_id = $1',
                [row.message_id],
            );
        }));
        await client.query('COMMIT');
        eventosPublicados.inc({ exchange: row.exchange, routing_key: row.routing_key });
        logger.info({
            tripId: row.viaje_id,
            messageId: row.message_id,
            exchange: row.exchange,
            routingKey: row.routing_key,
        }, 'Evento de viaje publicado');
        return true;
    } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
    } finally {
        client.release();
    }
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
