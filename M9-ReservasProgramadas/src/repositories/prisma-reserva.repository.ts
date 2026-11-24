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
import { measureDb } from '../observability/db.js';
import { recordTransition } from '../observability/metrics.js';
import { persistableTraceContext } from '../observability/tracing.js';
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

/**
 * El contexto de traza se captura AL CREAR el evento, dentro de la misma transacción, para que
 * la publicación posterior (incluso tras reiniciar el proceso) continúe la traza original.
 */
export const outboxData = (
  routingKey: string,
  event: EventEnvelope,
): Prisma.OutboxEventCreateInput => {
  const traceContext = persistableTraceContext();
  return {
    id: randomUUID(),
    eventId: event.eventId,
    aggregateId: event.aggregateId,
    eventType: event.eventType,
    eventVersion: event.eventVersion,
    routingKey,
    payload: toJson(event),
    correlationId: event.correlationId,
    traceContext: traceContext === null ? Prisma.DbNull : toJson(traceContext),
  };
};

export class PrismaReservaRepository implements ReservaRepository {
  public constructor(private readonly prisma: PrismaClient) {}

  public async crear(input: CrearReserva): Promise<Reserva> {
    const id = randomUUID();
    const correlationId = this.correlationId();
    const event = createReservationReferenceEvent({
      eventType: RESERVATION_EVENT_TYPES.created,
      correlationId,
      reservation: { id, estado: 'PROGRAMADA' },
    });
    // Los IDs ya se conocen: el motor puede ejecutar ambas escrituras sin esperar
    // callbacks de Node mientras mantiene abierta la conexión de la transacción.
    const [reservation] = await measureDb('reservation.create', () =>
      this.prisma.$transaction([
        this.prisma.reservation.create({
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
                : toJson(routeSnapshotSchema.parse(input.routeSnapshot)),
          },
        }),
        this.prisma.outboxEvent.create({ data: outboxData(event.eventType, event) }),
      ]),
    );
    const created = toDomain(reservation);
    // La transacción ya confirmó: recién ahora se cuenta el efecto.
    recordTransition('NONE', created.estado);
    return created;
  }

  public async obtenerPorId(id: string): Promise<Reserva | null> {
    const reservation = await measureDb('reservation.find_by_id', () =>
      this.prisma.reservation.findUnique({ where: { id } }),
    );
    return reservation === null ? null : toDomain(reservation);
  }

  public async listar(): Promise<Reserva[]> {
    const reservations = await measureDb('reservation.list', () =>
      this.prisma.reservation.findMany({
        orderBy: { scheduledAt: 'asc' },
      }),
    );
    return reservations.map(toDomain);
  }

  /** Listado paginado (aportado por la rama M9): orden estable fecha + id, máx. 100 por página. */
  public async listarPaginado(page = 1, pageSize = 20, clienteId?: string): Promise<Reserva[]> {
    const reservations = await measureDb('reservation.list_page', () =>
      this.prisma.reservation.findMany({
        where: clienteId === undefined ? {} : { clientId: clienteId },
        orderBy: [{ scheduledAt: 'asc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    );
    return reservations.map(toDomain);
  }

  public async actualizarProgramada(id: string, input: CambiosReserva): Promise<Reserva | null> {
    const correlationId = this.correlationId();
    return measureDb('reservation.update', () =>
      this.prisma.$transaction(async (transaction) => {
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
      }),
    );
  }

  public async cancelar(id: string, estadoEsperado: EstadoReserva): Promise<Reserva | null> {
    const correlationId = this.correlationId();
    const cancelled = await measureDb('reservation.cancel', () =>
      this.prisma.$transaction(async (transaction) => {
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
      }),
    );
    if (cancelled !== null) recordTransition(estadoEsperado, cancelled.estado);
    return cancelled;
  }

  public async recuperarActivacion(id: string, anteriorA: Date): Promise<boolean> {
    const result = await measureDb('reservation.recover_activation', () =>
      this.prisma.reservation.updateMany({
        where: { id, status: 'ACTIVANDO', dispatchRequestId: null, updatedAt: { lte: anteriorA } },
        data: { status: 'PROGRAMADA', version: { increment: 1 } },
      }),
    );
    if (result.count > 0) recordTransition('ACTIVANDO', 'PROGRAMADA');
    return result.count > 0;
  }

  public async buscarPendientes(
    fechaLimite: Date,
    limite = 100,
    clienteId?: string,
  ): Promise<Reserva[]> {
    const reservations = await measureDb('reservation.find_pending', () =>
      this.prisma.reservation.findMany({
        where: {
          ...(clienteId === undefined ? {} : { clientId: clienteId }),
          OR: [
            { status: 'ACTIVANDO' },
            { status: 'PROGRAMADA', scheduledAt: { lte: fechaLimite } },
          ],
        },
        orderBy: { scheduledAt: 'asc' },
        take: limite,
      }),
    );
    return reservations.map(toDomain);
  }

  public async cambiarEstado(
    id: string,
    estadoEsperado: EstadoReserva,
    nuevoEstado: EstadoReserva,
    cambio: CambioEstadoReserva = {},
  ): Promise<Reserva | null> {
    const correlationId = this.correlationId();
    const changed = await measureDb('reservation.change_status', () =>
      this.prisma.$transaction(async (transaction) => {
        if (estadoEsperado === 'PROGRAMADA' && nuevoEstado === 'ACTIVANDO') {
          // Un timeout puede ocultar una solicitud ya creada en M5. Inicializar
          // una sola vez, dentro de esta transacción, y conservarla al reintentar.
          await transaction.reservation.updateMany({
            where: { id, status: estadoEsperado, dispatchIdempotencyKey: null },
            data: { dispatchIdempotencyKey: randomUUID() },
          });
        }
        const result = await transaction.reservation.updateMany({
          where: { id, status: estadoEsperado },
          data: {
            status: nuevoEstado,
            ...(cambio.idSolicitud === undefined ? {} : { dispatchRequestId: cambio.idSolicitud }),
            ...(cambio.assignedDriverId === undefined
              ? {}
              : { assignedDriverId: cambio.assignedDriverId }),
            ...(cambio.criterioAsignacion === undefined
              ? {}
              : { assignmentCriteria: cambio.criterioAsignacion }),
            ...(cambio.routeSnapshot === undefined
              ? {}
              : {
                  routeSnapshot:
                    cambio.routeSnapshot === null ? Prisma.DbNull : toJson(cambio.routeSnapshot),
                }),
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
      }),
    );
    // Solo transiciones efectivamente confirmadas; un updateMany con count=0 no cuenta.
    if (changed !== null && estadoEsperado !== nuevoEstado) {
      recordTransition(estadoEsperado, nuevoEstado);
    }
    return changed;
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
