import { createNotificationsRouter } from '../app';
import { createRf81Application, type Rf81Application } from './rf81-application';

export interface NotificationsModule {
  name: 'notifications';
  router: ReturnType<typeof createNotificationsRouter>;
  readiness(): Promise<{ status: 'ok' | 'unavailable' }>;
  start(): void;
  stop(): Promise<void>;
}

export function createNotificationsModule(): NotificationsModule {
  const runtime: Rf81Application = createRf81Application({
    databaseUrl: process.env.NOTIFICATIONS_DATABASE_URL,
  });
  let available = false;
  let closing = false;
  let retryTimer: NodeJS.Timeout | undefined;

  const initialize = async (): Promise<void> => {
    try {
      await runtime.initialize();
      available = true;
    } catch {
      available = false;
      if (!closing) {
        retryTimer = setTimeout(() => {
          void initialize();
        }, 3000);
      }
    }
  };

  return {
    name: 'notifications',
    router: createNotificationsRouter(),
    async readiness() {
      return { status: available ? 'ok' : 'unavailable' };
    },
    start() {
      void initialize();
    },
    async stop() {
      closing = true;
      if (retryTimer !== undefined) {
        clearTimeout(retryTimer);
      }
      await runtime.close();
    },
  };
}
