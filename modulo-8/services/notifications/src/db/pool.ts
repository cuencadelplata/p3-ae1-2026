import { Pool } from "pg";

import { NotificationPersistenceError } from "../notifications/notification-persistence.error";

export function createNotificationsPool(databaseUrl: string | undefined): Pool {
  if (databaseUrl === undefined || databaseUrl.length === 0) {
    throw new NotificationPersistenceError("NOTIFICATIONS_DATABASE_URL debe estar configurada.");
  }

  const pool = new Pool({
    connectionString: databaseUrl,
    max: 10,
    connectionTimeoutMillis: 5_000,
    allowExitOnIdle: true,
  });
  // pg emite 'error' cuando una conexión inactiva se corta (por ejemplo, al
  // detener PostgreSQL). Sin listener, Node termina todo el proceso M8.
  pool.on("error", (error: Error) => {
    console.warn("[Notifications] Conexión inactiva de PostgreSQL interrumpida; se reintentará.", error.message);
  });
  return pool;
}
