import type { Pool } from "pg";

import { runMigrations } from "../db/migrations";
import { createNotificationsPool } from "../db/pool";
import { createPostgresNotificationWithOutboxRepository } from "../repositories/postgres-notification-outbox.repository";
import type { NotificationDeliveryIntent, NotificationWithOutboxRepository } from "./notification-outbox.repository";
import { processNormalizedTripNotificationEvent, type ProcessNormalizedTripNotificationEventResult } from "./normalized-trip-notification.service";

export interface Rf81Application {
  processTripEvent(value: unknown): Promise<ProcessNormalizedTripNotificationEventResult>;
  outbox: {
    findPending(limit: number): Promise<NotificationDeliveryIntent[]>;
    markPublished(messageId: string, publishedAt: string): Promise<boolean>;
  };
  initialize(): Promise<void>;
  close(): Promise<void>;
}

export interface CreateRf81ApplicationOptions {
  databaseUrl?: string;
  pool?: Pool;
  repository?: NotificationWithOutboxRepository;
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

  return {
    processTripEvent(value: unknown): Promise<ProcessNormalizedTripNotificationEventResult> {
      return processNormalizedTripNotificationEvent(value, repository);
    },
    outbox: {
      findPending(limit: number): Promise<NotificationDeliveryIntent[]> {
        return repository.findPending(limit);
      },
      markPublished(messageId: string, publishedAt: string): Promise<boolean> {
        return repository.markPublished(messageId, publishedAt);
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
