import { randomUUID } from 'node:crypto';

import {
  Prisma,
  type PrismaClient,
  type Reservation as PersistenceReservation,
} from '@prisma/client';
import { z } from 'zod';

import type {
  CambiosReserva,
  CambioEstadoReserva,
  CrearReserva,
  EstadoReserva,
  Reserva,
} from '../domain/reserva.js';
import { getRequestContext } from '../integration/request-context.js';
import { createEventEnvelope, type EventEnvelope } from '../messaging/event-envelope.js';
import {
  createReservationReferenceEvent,
  RESERVATION_EVENT_TYPES,
  type ReadyForDispatchPayload,
} from '../messaging/reservation-events.js';
import type { ReservaRepository } from './reserva.repository.js';

const routeSnapshotSchema = z.object({
  origin: z.object({ latitude: z.number(), longitude: z.number(), address: z.string() }),
  destination: z.object({ latitude: z.number(), longitude: z.number(), address: z.string() }),
  distanceKm: z.number().nonnegative(),
  estimatedDurationMin: z.number().nonnegative(),
});

const toJson = (value: unknown): Prisma.InputJsonValue => value as Prisma.InputJsonValue;

const toDomain = (reservation: PersistenceReservation): Reserva => ({
  id: reservation.id,
  clienteId: reservation.clientId,
  origen: reservation.origin,
  destino: reservation.destination,
  vehiculo: reservation.vehicleType,
  fechaHoraProgramada: reservation.scheduledAt.toISOString(),
  estado: reservation.status,
  tarifaEstimada: reservation.estimatedFare?.toNumber() ?? null,
  moneda: reservation.currency,
  estimacionTarifaId: reservation.fareEstimateId,
  routeSnapshot:
    reservation.routeSnapshot === null
      ? null
      : routeSnapshotSchema.parse(reservation.routeSnapshot),
  criterioAsignacion: reservation.assignmentCriteria,
  idSolicitud: reservation.dispatchRequestId,
  assignedDriverId: reservation.assignedDriverId,
  creadoEn: reservation.createdAt.toISOString(),
  actualizadoEn: reservation.updatedAt.toISOString(),
});

const outboxData = (routingKey: string, event: EventEnvelope): Prisma.OutboxEventCreateInput => ({
  id: randomUUID(),
  eventId: event.eventId,
  aggregateId: event.aggregateId,
  eventType: event.eventType,
  eventVersion: event.eventVersion,
  routingKey,
  payload: toJson(event),
  correlationId: event.correlationId,
});

export class PrismaReservaRepository implements ReservaRepository {
  public constructor(private readonly prisma: PrismaClient) {}

  public async crear(input: CrearReserva): Promise<Reserva> {
    const id = randomUUID();
    const correlationId = this.correlationId();
    return this.prisma.$transaction(async (transaction) => {
      const reservation = await transaction.reservation.create({
        data: {
          id,
          clientId: input.clienteId,
          origin: input.origen,
          destination: input.destino,
          vehicleType: input.vehiculo,
          scheduledAt: new Date(input.fechaHoraProgramada),
          estimatedFare: input.tarifaEstimada,
          currency: input.moneda ?? 'ARS',
          fareEstimateId: input.estimacionTarifaId,
          routeSnapshot:
            input.routeSnapshot === null || input.routeSnapshot === undefined
              ? Prisma.DbNull
              : toJson(input.routeSnapshot),
        },
      });
      const domain = toDomain(reservation);
      const event = createReservationReferenceEvent({
        eventType: RESERVATION_EVENT_TYPES.created,
        correlationId,
        reservation: domain,
      });
      await transaction.outboxEvent.create({ data: outboxData(event.eventType, event) });
      return domain;
    });
  }

  public async obtenerPorId(id: string): Promise<Reserva | null> {
    const reservation = await this.prisma.reservation.findUnique({ where: { id } });
    return reservation === null ? null : toDomain(reservation);
  }

  public async listar(): Promise<Reserva[]> {
    const reservations = await this.prisma.reservation.findMany({
      orderBy: { scheduledAt: 'asc' },
    });
    return reservations.map(toDomain);
  }

  public async actualizarProgramada(id: string, input: CambiosReserva): Promise<Reserva | null> {
    const correlationId = this.correlationId();
    return this.prisma.$transaction(async (transaction) => {
      const result = await transaction.reservation.updateMany({
        where: { id, status: 'PROGRAMADA' },
        data: {
          ...(input.origen === undefined ? {} : { origin: input.origen }),
          ...(input.destino === undefined ? {} : { destination: input.destino }),
          ...(input.vehiculo === undefined ? {} : { vehicleType: input.vehiculo }),
          ...(input.fechaHoraProgramada === undefined
            ? {}
            : { scheduledAt: new Date(input.fechaHoraProgramada) }),
          ...(input.tarifaEstimada === undefined ? {} : { estimatedFare: input.tarifaEstimada }),
          ...(input.moneda === undefined ? {} : { currency: input.moneda }),
          ...(input.estimacionTarifaId === undefined
            ? {}
            : { fareEstimateId: input.estimacionTarifaId }),
          ...(input.routeSnapshot === undefined
            ? {}
            : {
                routeSnapshot:
                  input.routeSnapshot === null ? Prisma.DbNull : toJson(input.routeSnapshot),
              }),
          version: { increment: 1 },
        },
      });
      if (result.count === 0) return null;
      const reservation = await transaction.reservation.findUniqueOrThrow({ where: { id } });
      const domain = toDomain(reservation);
      const event = createReservationReferenceEvent({
        eventType: RESERVATION_EVENT_TYPES.updated,
        correlationId,
        reservation: domain,
      });
      await transaction.outboxEvent.create({ data: outboxData(event.eventType, event) });
      return domain;
    });
  }

  public async cancelar(id: string, estadoEsperado: EstadoReserva): Promise<Reserva | null> {
    const correlationId = this.correlationId();
    return this.prisma.$transaction(async (transaction) => {
      const result = await transaction.reservation.updateMany({
        where: { id, status: estadoEsperado },
        data: { status: 'CANCELADA', version: { increment: 1 } },
      });
      if (result.count === 0) return null;
      const reservation = await transaction.reservation.findUniqueOrThrow({ where: { id } });
      const domain = toDomain(reservation);
      const event = createReservationReferenceEvent({
        eventType: RESERVATION_EVENT_TYPES.cancelled,
        correlationId,
        reservation: domain,
      });
      await transaction.outboxEvent.create({ data: outboxData(event.eventType, event) });
      return domain;
    });
  }

  public async buscarPendientes(fechaLimite: Date, limite = 100): Promise<Reserva[]> {
    const reservations = await this.prisma.reservation.findMany({
      where: {
        OR: [{ status: 'ACTIVANDO' }, { status: 'PROGRAMADA', scheduledAt: { lte: fechaLimite } }],
      },
      orderBy: { scheduledAt: 'asc' },
      take: limite,
    });
    return reservations.map(toDomain);
  }

  public async cambiarEstado(
    id: string,
    estadoEsperado: EstadoReserva,
    nuevoEstado: EstadoReserva,
    cambio: CambioEstadoReserva = {},
  ): Promise<Reserva | null> {
    const correlationId = this.correlationId();
    return this.prisma.$transaction(async (transaction) => {
      const idempotencyKey =
        estadoEsperado === 'PROGRAMADA' && nuevoEstado === 'ACTIVANDO' ? randomUUID() : undefined;
      const result = await transaction.reservation.updateMany({
        where: { id, status: estadoEsperado },
        data: {
          status: nuevoEstado,
          ...(cambio.idSolicitud === undefined ? {} : { dispatchRequestId: cambio.idSolicitud }),
          ...(cambio.assignedDriverId === undefined
            ? {}
            : { assignedDriverId: cambio.assignedDriverId }),
          ...(cambio.routeSnapshot === undefined
            ? {}
            : {
                routeSnapshot:
                  cambio.routeSnapshot === null ? Prisma.DbNull : toJson(cambio.routeSnapshot),
              }),
          ...(idempotencyKey === undefined ? {} : { dispatchIdempotencyKey: idempotencyKey }),
          version: { increment: 1 },
        },
      });
      if (result.count === 0) return null;
      const reservation = await transaction.reservation.findUniqueOrThrow({ where: { id } });
      const domain = toDomain(reservation);
      const event = this.transitionEvent(
        domain,
        correlationId,
        reservation.dispatchIdempotencyKey,
        estadoEsperado,
        nuevoEstado,
      );
      if (event !== null) {
        await transaction.outboxEvent.create({ data: outboxData(event.eventType, event) });
      }
      return domain;
    });
  }

  private transitionEvent(
    reservation: Reserva,
    correlationId: string,
    idempotencyKey: string | null,
    previousStatus: EstadoReserva,
    nextStatus: EstadoReserva,
  ): EventEnvelope | null {
    if (
      previousStatus === 'PROGRAMADA' &&
      nextStatus === 'ACTIVANDO' &&
      reservation.routeSnapshot !== null &&
      idempotencyKey !== null
    ) {
      return createEventEnvelope<ReadyForDispatchPayload>({
        eventType: RESERVATION_EVENT_TYPES.readyForDispatch,
        correlationId,
        aggregateId: reservation.id,
        payload: {
          reservationId: reservation.id,
          status: reservation.estado,
          vehicleType: reservation.vehiculo,
          route: reservation.routeSnapshot,
          idempotencyKey,
        },
      });
    }

    const eventType =
      reservation.estado === 'ACTIVADA'
        ? RESERVATION_EVENT_TYPES.activated
        : reservation.estado === 'FALLIDA'
          ? RESERVATION_EVENT_TYPES.failed
          : null;
    return eventType === null
      ? null
      : createReservationReferenceEvent({ eventType, correlationId, reservation });
  }

  private correlationId(): string {
    return getRequestContext()?.correlationId ?? randomUUID();
  }
}
