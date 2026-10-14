import { Pool } from "pg";

import { NotificationPersistenceError } from "../notifications/notification-persistence.error";

export function createNotificationsPool(databaseUrl: string | undefined): Pool {
  if (databaseUrl === undefined || databaseUrl.length === 0) {
    throw new NotificationPersistenceError("NOTIFICATIONS_DATABASE_URL debe estar configurada.");
  }

  return new Pool({
    connectionString: databaseUrl,
    max: 10,
    connectionTimeoutMillis: 5_000,
    allowExitOnIdle: true,
  });
}
