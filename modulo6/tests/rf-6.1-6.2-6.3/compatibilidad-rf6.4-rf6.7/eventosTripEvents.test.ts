import amqp from 'amqplib';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import pool from '../../../src/rf-6.1-6.2-6.3/db/pool.js';
import { EstadoViaje, type Viaje } from '../../../src/rf-6.1-6.2-6.3/models/viaje.model.js';
import * as viajeRepo from '../../../src/rf-6.1-6.2-6.3/repositories/viaje.repository.js';
import {
    cerrarPublicador,
    despacharEventosPendientes,
    eventosViajeFinalizado,
    eventoTripEvents,
} from '../../../src/rf-6.1-6.2-6.3/services/eventos-viaje.service.js';

// Contrato con M4: exchange trip.events, routing key = eventType,
// cuerpo { eventId, eventType, tripId, driverId (userId numérico de M1), occurredAt }.

beforeEach(async () => {
    await pool.query('TRUNCATE viajes RESTART IDENTITY CASCADE');
    await pool.query('DELETE FROM viaje_eventos_outbox').catch(() => undefined);
});

afterAll(async () => {
    await cerrarPublicador();
});

async function crearViaje(clienteId = `cli-${randomUUID()}`): Promise<string> {
    const viaje: Viaje = {
        id: randomUUID(),
        clienteId,
        clientUserId: 42,
        estado: EstadoViaje.SOLICITADO,
        origen: 'Calle A',
        destino: 'Calle B',
        codigoVerificacion: null,
        qrCode: null,
        qrExpiresAt: null,
        fechaCreacion: new Date(),
    };
    await viajeRepo.crear(viaje);
    return viaje.id;
}

async function eventosTrip(viajeId: string) {
    const { rows } = await pool.query(
        `SELECT routing_key, payload FROM viaje_eventos_outbox
         WHERE viaje_id = $1 AND exchange = 'trip.events' ORDER BY creado_at`,
        [viajeId],
    );
    return rows as Array<{ routing_key: string; payload: Record<string, unknown> }>;
}

describe('Contrato trip.events para M4', () => {
    it('arma el mensaje plano con driverId numérico y eventId = messageId', () => {
        const evento = eventoTripEvents('viaje.iniciado', {
            viajeId: 'trip-1',
            driverUserId: 7,
            conductorId: 'conductor-texto',
            occurredAt: new Date('2026-11-17T15:20:31.512Z'),
        });

        expect(evento).not.toBeNull();
        expect(evento).toMatchObject({ exchange: 'trip.events', routingKey: 'viaje.iniciado' });
        expect(evento!.payload).toEqual({
            eventId: evento!.messageId,
            eventType: 'viaje.iniciado',
            tripId: 'trip-1',
            driverId: 7,
            occurredAt: '2026-11-17T15:20:31.512Z',
        });
        expect(evento!.messageId).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('prefiere el driverUserId guardado y usa el conductorId sólo si es numérico', () => {
        const fecha = new Date();
        expect(eventoTripEvents('viaje.cancelado', { viajeId: 't', driverUserId: 9, conductorId: '3', occurredAt: fecha })!
            .payload.driverId).toBe(9);
        expect(eventoTripEvents('viaje.cancelado', { viajeId: 't', driverUserId: null, conductorId: '3', occurredAt: fecha })!
            .payload.driverId).toBe(3);
        expect(eventoTripEvents('viaje.cancelado', { viajeId: 't', driverUserId: null, conductorId: 'conductor-ana', occurredAt: fecha }))
            .toBeNull();
        expect(eventoTripEvents('viaje.cancelado', { viajeId: 't', driverUserId: 0, conductorId: null, occurredAt: fecha }))
            .toBeNull();
    });

    it('la finalización usa driverUserId y clientUserId guardados', () => {
        const eventos = eventosViajeFinalizado({
            viajeId: 'trip-2',
            clienteId: 'cliente-texto',
            conductorId: 'conductor-texto',
            clientUserId: 42,
            driverUserId: 7,
            finalizadoAt: new Date(),
            total: 1000,
            paymentId: 'PAY-trip-2',
        });
        const porExchange = Object.fromEntries(eventos.map((e) => [e.exchange, e]));

        expect(porExchange['trip.events'].payload).toMatchObject({ eventType: 'viaje.finalizado', tripId: 'trip-2', driverId: 7 });
        expect(porExchange['mobility.events'].payload).toMatchObject({ data: { tripId: 'trip-2', recipientId: 42 } });
        expect(porExchange['viajes.events']).toBeDefined();
    });

    it('iniciar el viaje deja viaje.iniciado en el outbox, en la misma transacción', async () => {
        const id = await crearViaje();
        await viajeRepo.actualizarEstado(id, EstadoViaje.CONDUCTOR_EN_CAMINO, 'conductor-ana', 77);
        await viajeRepo.marcarArribado(id);

        const iniciado = await viajeRepo.iniciarSiArribado(id);
        const eventos = await eventosTrip(id);

        expect(iniciado?.estado).toBe(EstadoViaje.EN_CURSO);
        expect(eventos).toHaveLength(1);
        expect(eventos[0]).toMatchObject({
            routing_key: 'viaje.iniciado',
            payload: { eventType: 'viaje.iniciado', tripId: id, driverId: 77 },
        });
    });

    it('un segundo intento de iniciar no duplica el evento', async () => {
        const id = await crearViaje();
        await viajeRepo.actualizarEstado(id, EstadoViaje.CONDUCTOR_EN_CAMINO, 'conductor-ana', 77);
        await viajeRepo.marcarArribado(id);

        await Promise.all([viajeRepo.iniciarSiArribado(id), viajeRepo.iniciarSiArribado(id)]);

        expect(await eventosTrip(id)).toHaveLength(1);
    });

    it('cancelar con conductor asignado deja viaje.cancelado para liberarlo', async () => {
        const id = await crearViaje();
        await viajeRepo.actualizarEstado(id, EstadoViaje.CONDUCTOR_EN_CAMINO, 'conductor-luis', 55);

        const cancelado = await viajeRepo.cancelarSiCancelable(id, 'conductor', 'Me quedé sin nafta');
        const eventos = await eventosTrip(id);

        expect(cancelado?.estado).toBe(EstadoViaje.CANCELADO);
        expect(eventos).toHaveLength(1);
        expect(eventos[0]).toMatchObject({
            routing_key: 'viaje.cancelado',
            payload: { eventType: 'viaje.cancelado', tripId: id, driverId: 55 },
        });
    });

    it('cancelar un viaje sin conductor no publica en trip.events', async () => {
        const id = await crearViaje();

        await viajeRepo.cancelarSiCancelable(id, 'cliente', 'Cambié de planes');

        expect(await eventosTrip(id)).toHaveLength(0);
    });

    it('publica en RabbitMQ (trip.events) lo que recibe M4: iniciado, finalizado y cancelado', async () => {
        const conexion = await amqp.connect(process.env.RABBITMQ_URL ?? 'amqp://guest:guest@127.0.0.1:5672');
        const canal = await conexion.createChannel();
        try {
            await canal.assertExchange('trip.events', 'topic', { durable: true });
            const { queue } = await canal.assertQueue('', { exclusive: true });
            for (const key of ['viaje.iniciado', 'viaje.finalizado', 'viaje.cancelado']) {
                await canal.bindQueue(queue, 'trip.events', key);
            }

            // Viaje 1: asignado (driverUserId 77) → iniciado → finalizado.
            const v1 = await crearViaje();
            await viajeRepo.actualizarEstado(v1, EstadoViaje.CONDUCTOR_EN_CAMINO, 'conductor-ana', 77);
            await viajeRepo.marcarArribado(v1);
            await viajeRepo.iniciarSiArribado(v1);
            await viajeRepo.finalizarSiEnCurso(v1, async (_viaje, inicio) => ({
                inicio,
                horaFin: new Date(),
                tiempoMinutos: 1,
                tiempoEstimadoMinutos: 3,
                distanciaKm: 1.11,
                metodoPago: 'efectivo',
                total: 827.5,
                moneda: 'ARS',
                origen: { latitude: 0, longitude: 0 },
                destino: { latitude: 0, longitude: 0.01 },
                tipoVehiculo: 'auto',
                fuenteMetrica: 'M4',
                metricasEstimadas: true,
                estadoPago: 'pendiente',
                paymentId: `PAY-${v1}`,
            }));
            // Viaje 2: asignado (driverUserId 55) → cancelado por el conductor.
            const v2 = await crearViaje();
            await viajeRepo.actualizarEstado(v2, EstadoViaje.CONDUCTOR_EN_CAMINO, 'conductor-luis', 55);
            await viajeRepo.cancelarSiCancelable(v2, 'conductor', 'Imprevisto');

            await despacharEventosPendientes();

            const recibidos: Array<{ routingKey: string; messageId?: string; contentType?: string; persistente: boolean; cuerpo: any }> = [];
            for (let intento = 0; intento < 40 && recibidos.length < 3; intento += 1) {
                const mensaje = await canal.get(queue, { noAck: true });
                if (!mensaje) { await new Promise((r) => setTimeout(r, 100)); continue; }
                recibidos.push({
                    routingKey: mensaje.fields.routingKey,
                    messageId: mensaje.properties.messageId,
                    contentType: mensaje.properties.contentType,
                    persistente: mensaje.properties.deliveryMode === 2,
                    cuerpo: JSON.parse(mensaje.content.toString()),
                });
            }

            expect(recibidos.map((m) => [m.routingKey, m.cuerpo.tripId, m.cuerpo.driverId])).toEqual([
                ['viaje.iniciado', v1, 77],
                ['viaje.finalizado', v1, 77],
                ['viaje.cancelado', v2, 55],
            ]);
            for (const m of recibidos) {
                expect(Object.keys(m.cuerpo).sort()).toEqual(['driverId', 'eventId', 'eventType', 'occurredAt', 'tripId']);
                expect(m.cuerpo.eventType).toBe(m.routingKey);
                expect(m.messageId).toBe(m.cuerpo.eventId);
                expect(m.contentType).toBe('application/json');
                expect(m.persistente).toBe(true);
                expect(Number.isNaN(Date.parse(m.cuerpo.occurredAt))).toBe(false);
            }
            const { rows } = await pool.query(
                `SELECT count(*)::int AS pendientes FROM viaje_eventos_outbox
                 WHERE exchange = 'trip.events' AND publicado_at IS NULL`,
            );
            expect(rows[0].pendientes).toBe(0);
        } finally {
            await canal.close();
            await conexion.close();
        }
    });

    it.each([EstadoViaje.COMPLETADO, EstadoViaje.CANCELADO])('no publica eventos al intentar cancelar un viaje terminal %s', async (estado) => {
        const id = await crearViaje();
        await pool.query('UPDATE viajes SET estado = $1 WHERE id = $2', [estado, id]);

        const resultado = await viajeRepo.cancelarSiCancelable(id, 'cliente', 'Tarde');

        expect(resultado).toBeNull();
        expect((await eventosTrip(id)).map((e) => e.routing_key)).toEqual([]);
    });
});
