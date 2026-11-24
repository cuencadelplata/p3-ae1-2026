import { describe, expect, it } from 'vitest';
import { eventosViajeCancelado } from '../../src/rf-6.1-6.2-6.3/services/eventos-viaje.service.js';

describe('eventosViajeCancelado', () => {
    it('crea un evento con el sobre común para cada destinatario', () => {
        const canceladoAt = new Date('2026-11-17T15:20:31.512Z');
        const eventos = eventosViajeCancelado({
            viajeId: 'trip-cancelled',
            clienteId: 'cliente-texto',
            conductorId: 'conductor-texto',
            clientUserId: 42,
            driverUserId: 7,
            canceladoAt,
            cancelledBy: 'conductor',
            motivo: 'Imprevisto',
        });

        expect(eventos).toHaveLength(2);
        expect(eventos.map((evento) => evento.exchange)).toEqual(['mobility.events', 'mobility.events']);
        expect(eventos.map((evento) => evento.routingKey)).toEqual(['trip.cancelled', 'trip.cancelled']);
        expect(eventos[0].messageId).not.toBe(eventos[1].messageId);
        expect(eventos.map((evento) => (evento.payload.data as { recipientId: number }).recipientId)).toEqual([42, 7]);

        for (const evento of eventos) {
            expect(evento.payload).toMatchObject({
                messageId: evento.messageId,
                eventType: 'TripCancelled',
                version: 1,
                occurredAt: canceladoAt.toISOString(),
                correlationId: 'trip-cancelled',
                producer: 'm6-viajes',
                data: {
                    tripId: 'trip-cancelled',
                    cancelledBy: 'conductor',
                    motivo: 'Imprevisto',
                },
            });
        }
    });

    it('omite eventos para destinatarios sin userId numérico de M1', () => {
        const eventos = eventosViajeCancelado({
            viajeId: 'trip-invalid-users',
            clienteId: 'cliente-ana',
            conductorId: 'conductor-luis',
            canceladoAt: new Date(),
            cancelledBy: 'cliente',
            motivo: 'Cambio de planes',
        });

        expect(eventos).toEqual([]);
    });
});
