import type { Pool } from "pg";
import type { PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import { NonRetryableMessagingError, type EventEnvelope } from "@m8/shared";

import { runMigrations } from "../db/migrations";
import { createNotificationsPool } from "../db/pool";
import { createPostgresNotificationWithOutboxRepository } from "../repositories/postgres-notification-outbox.repository";
import type { NotificationDeliveryIntent, NotificationWithOutboxRepository } from "./notification-outbox.repository";
import {
  processDriverDocumentRegisteredEvent,
  processDriverDocumentRegisteredEventWithClient,
  processNormalizedTripNotificationEvent,
  processNormalizedTripNotificationEventWithClient,
  type ProcessDriverDocumentRegisteredEventResult,
  type ProcessNormalizedTripNotificationEventResult,
} from "./normalized-trip-notification.service";
import { mapTripEventEnvelope } from "./trip-event-envelope.mapper";
import type { LogicalNotification, NotificationRequestedEnvelope } from "./notification.types";
import type { DriverNameLookup } from "./m1-driver-name.client";
import type { ActiveVehicleLookup } from "./m3-vehicle.client";

export interface Rf81Application {
  processTripEvent(value: unknown): Promise<ProcessNormalizedTripNotificationEventResult>;
  processTripEventEnvelope(value: unknown): Promise<ProcessNormalizedTripNotificationEventResult>;
  processM5EventEnvelope(value: EventEnvelope): Promise<void>;
  processDriverDocumentRegisteredEvent(value: unknown): Promise<ProcessDriverDocumentRegisteredEventResult>;
  processDriverDocumentRegisteredEventWithClient(
    client: PoolClient,
    value: unknown,
  ): Promise<ProcessDriverDocumentRegisteredEventResult>;
  processTripEventWithClient(
    client: PoolClient,
    value: unknown,
  ): Promise<ProcessNormalizedTripNotificationEventResult>;
  outbox: {
    findPending(limit: number): Promise<NotificationDeliveryIntent[]>;
    claimPendingForPublish(client: PoolClient, limit: number): Promise<NotificationRequestedEnvelope[]>;
    markPublished(messageId: string, publishedAt: string): Promise<boolean>;
    markPublishedWithClient(client: PoolClient, messageId: string, publishedAt: string): Promise<boolean>;
  };
  initialize(): Promise<void>;
  close(): Promise<void>;
}

export interface CreateRf81ApplicationOptions {
  databaseUrl?: string;
  pool?: Pool;
  repository?: NotificationWithOutboxRepository;
  driverNameLookup?: DriverNameLookup;
  activeVehicleLookup?: ActiveVehicleLookup;
}

export function createRf81Application(options: CreateRf81ApplicationOptions): Rf81Application {
  let pool = options.pool;
  let ownsPool = false;
  let repository = options.repository;

  if (repository === undefined) {
    if (pool === undefined) {
      pool = createNotificationsPool(options.databaseUrl);
      ownsPool = true;
    }
    repository = createPostgresNotificationWithOutboxRepository(pool);
  }

  const makeM5Notification = (
    envelope: EventEnvelope,
    recipientId: number,
    eventType: "TripAssigned" | "TripCancelled",
    title: string,
    message: string,
  ): LogicalNotification => {
    return {
      notificationId: randomUUID(),
      sourceMessageId: envelope.messageId,
      tripId: eventType === "TripAssigned" ? envelope.data.tripId as string : null,
      rideRequestId: envelope.data.rideRequestId as string,
      recipientId,
      eventType,
      title,
      message,
      correlationId: envelope.correlationId,
      occurredAt: envelope.occurredAt,
      createdAt: new Date().toISOString(),
    };
  };

  return {
    processTripEvent(value: unknown): Promise<ProcessNormalizedTripNotificationEventResult> {
      return processNormalizedTripNotificationEvent(value, repository);
    },
    processTripEventEnvelope(value: unknown): Promise<ProcessNormalizedTripNotificationEventResult> {
      const mapped = mapTripEventEnvelope(value);
      if (!mapped.valid) {
        return Promise.resolve({ status: "INVALID_EVENT", valid: false, details: mapped.details });
      }
      return processNormalizedTripNotificationEvent(mapped.data, repository);
    },
    async processM5EventEnvelope(value: EventEnvelope): Promise<void> {
      if (value.eventType === "TripRequested") {
        const result = await this.processTripEventEnvelope(value);
        if (!result.valid) {
          if (result.status === "INVALID_EVENT") throw new NonRetryableMessagingError("M8 rechazo ride.requested.");
          throw result.error;
        }
        return;
      }
      if (value.eventType === "DriverAssigned") {
        const { clientUserId, driverUserId, vehicleType, origin, destination } = value.data;
        const vehicle = vehicleType === "MOTO" ? "moto" : "auto";
        const from = (origin as { address: string }).address;
        const to = (destination as { address: string }).address;
        const [driverName, activeVehicle] = await Promise.all([
          options.driverNameLookup?.(driverUserId as number).catch(() => null),
          options.activeVehicleLookup?.(driverUserId as number, vehicleType as "AUTO" | "MOTO").catch(() => null),
        ]);
        const driverDescription = driverName ? `el conductor ${driverName}` : "un conductor";
        const vehicleDescription = activeVehicle
          ? `${vehicle} ${activeVehicle.marca} ${activeVehicle.modelo}, patente ${activeVehicle.patente}`
          : vehicle;
        const clientNotification = makeM5Notification(value, clientUserId as number, "TripAssigned",
          "Conductor asignado", `Tu viaje fue asignado a ${driverDescription} en ${vehicleDescription}. Origen: ${from}. Destino: ${to}.`);
        const driverNotification = makeM5Notification(value, driverUserId as number, "TripAssigned",
          "Viaje asignado", `Se te asignó un viaje en ${vehicle}. Recogida: ${from}. Destino: ${to}.`);
        if (pool !== undefined) {
          const client = await pool.connect();
          try {
            await client.query("BEGIN");
            await repository.saveWithOutboxUsingClient(client, clientNotification);
            await repository.saveWithOutboxUsingClient(client, driverNotification);
            await client.query("COMMIT");
          } catch (error) {
            await client.query("ROLLBACK").catch(() => undefined);
            throw error;
          } finally {
            client.release();
          }
        } else {
          await repository.saveWithOutbox(clientNotification);
          await repository.saveWithOutbox(driverNotification);
        }
        return;
      }
      if (value.eventType === "TripCancelled") {
        await repository.saveWithOutbox(makeM5Notification(value, value.data.clientUserId as number, "TripCancelled",
          "Solicitud cancelada", "Tu solicitud de viaje fue cancelada."));
        return;
      }
      throw new NonRetryableMessagingError("Evento M5 no permitido.");
    },
    processDriverDocumentRegisteredEvent(
      value: unknown,
    ): Promise<ProcessDriverDocumentRegisteredEventResult> {
      return processDriverDocumentRegisteredEvent(value, repository);
    },
    processDriverDocumentRegisteredEventWithClient(
      client: PoolClient,
      value: unknown,
    ): Promise<ProcessDriverDocumentRegisteredEventResult> {
      return processDriverDocumentRegisteredEventWithClient(client, value, repository);
    },
    processTripEventWithClient(
      client: PoolClient,
      value: unknown,
    ): Promise<ProcessNormalizedTripNotificationEventResult> {
      return processNormalizedTripNotificationEventWithClient(client, value, repository);
    },
    outbox: {
      findPending(limit: number): Promise<NotificationDeliveryIntent[]> {
        return repository.findPending(limit);
      },
      claimPendingForPublish(client: PoolClient, limit: number): Promise<NotificationRequestedEnvelope[]> {
        return repository.claimPendingForPublish(client, limit);
      },
      markPublished(messageId: string, publishedAt: string): Promise<boolean> {
        return repository.markPublished(messageId, publishedAt);
      },
      markPublishedWithClient(client: PoolClient, messageId: string, publishedAt: string): Promise<boolean> {
        return repository.markPublishedWithClient(client, messageId, publishedAt);
      },
    },
    async initialize(): Promise<void> {
      if (pool !== undefined) {
        await runMigrations(pool);
      }
    },
    async close(): Promise<void> {
      if (ownsPool && pool !== undefined) {
        await pool.end();
      }
    },
  };
}
