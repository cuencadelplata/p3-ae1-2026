import type { PoolClient } from 'pg';
import { createRequire } from 'node:module';
import { PostgresTechnicalInbox } from '@m8/shared';

import { createNotificationsRouter } from '../app';
import { createNotificationsPool } from '../db/pool';
import {
  M3DriverDocumentRegisteredConsumer,
  type RabbitMqConnection,
} from '../messaging/m3-driver-document-registered.consumer';
import { NotificationOutboxRelay } from '../messaging/notification-outbox-relay';
import { createRf81Application, type Rf81Application } from './rf81-application';

export interface NotificationsModule {
  name: 'notifications';
  router: ReturnType<typeof createNotificationsRouter>;
  readiness(): Promise<{ status: 'ok' | 'unavailable' }>;
  processDriverDocumentRegisteredEvent(
    value: unknown,
  ): ReturnType<Rf81Application['processDriverDocumentRegisteredEvent']>;
  processDriverDocumentRegisteredEventWithClient(
    client: PoolClient,
    value: unknown,
  ): ReturnType<Rf81Application['processDriverDocumentRegisteredEventWithClient']>;
  start(): void;
  stop(): Promise<void>;
}

export function createNotificationsModule(): NotificationsModule {
  const amqp = createRequire(__filename)('amqplib') as {
    connect(url: string): Promise<RabbitMqConnection>;
  };
  const databaseUrl = process.env.NOTIFICATIONS_DATABASE_URL;
  const runtime: Rf81Application = createRf81Application({ databaseUrl });
  // El Inbox es infraestructura de RF8.6 y usa CommunicationsDB, nunca datos de M3.
  const messagingPool = createNotificationsPool(databaseUrl);
  let available = false;
  let closing = false;
  let retryTimer: NodeJS.Timeout | undefined;
  let m3RetryTimer: NodeJS.Timeout | undefined;
  let m3Connection: RabbitMqConnection | undefined;
  let m3Consumer: M3DriverDocumentRegisteredConsumer | undefined;
  let outboxChannel: Awaited<ReturnType<RabbitMqConnection['createConfirmChannel']>> | undefined;
  let outboxRelay: NotificationOutboxRelay | undefined;

  const startM3DocumentConsumer = async (): Promise<void> => {
    if (closing || m3Consumer?.isReady()) return;
    const rabbitUrl = process.env.RABBITMQ_URL;
    if (rabbitUrl === undefined || rabbitUrl.trim() === '') {
      console.warn('[RF8.6] RABBITMQ_URL no está configurada; el consumer M3 queda detenido.');
      return;
    }

    try {
      m3Connection = await amqp.connect(rabbitUrl);
      m3Consumer = new M3DriverDocumentRegisteredConsumer({
        connection: m3Connection,
        inboxStore: new PostgresTechnicalInbox(messagingPool),
        deliverToRf81: (value) => runtime.processDriverDocumentRegisteredEvent(value),
      });
      await m3Consumer.start();
      outboxChannel = await m3Connection.createConfirmChannel();
      await outboxChannel.assertExchange('mobility.events', 'topic', { durable: true });
      outboxRelay = new NotificationOutboxRelay(messagingPool, runtime.outbox, outboxChannel);
      outboxRelay.start();
    } catch (error) {
      outboxRelay?.stop();
      await outboxChannel?.close().catch(() => undefined);
      await m3Consumer?.stop().catch(() => undefined);
      await m3Connection?.close().catch(() => undefined);
      outboxRelay = undefined;
      outboxChannel = undefined;
      m3Consumer = undefined;
      m3Connection = undefined;
      if (!closing) {
        console.warn('[RF8.6] No se pudo iniciar el consumer M3; se reintentará.', error);
        m3RetryTimer = setTimeout(() => void startM3DocumentConsumer(), 3000);
      }
    }
  };

  const initialize = async (): Promise<void> => {
    try {
      await runtime.initialize();
      available = true;
      void startM3DocumentConsumer();
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
    processDriverDocumentRegisteredEvent(value) {
      return runtime.processDriverDocumentRegisteredEvent(value);
    },
    processDriverDocumentRegisteredEventWithClient(client, value) {
      return runtime.processDriverDocumentRegisteredEventWithClient(client, value);
    },
    start() {
      void initialize();
    },
    async stop() {
      closing = true;
      if (retryTimer !== undefined) {
        clearTimeout(retryTimer);
      }
      if (m3RetryTimer !== undefined) {
        clearTimeout(m3RetryTimer);
      }
      outboxRelay?.stop();
      await outboxChannel?.close().catch(() => undefined);
      await m3Consumer?.stop();
      await m3Connection?.close().catch(() => undefined);
      await runtime.close();
      await messagingPool.end();
    },
  };
}
