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
import { M6TripEventsConsumer } from '../messaging/m6-trip-events.consumer';
import { M5TripEventsConsumer } from '../messaging/m5-trip-events.consumer';
import { createRf81Application, type Rf81Application } from './rf81-application';
import { createM3DriverNameLookup } from './m3-driver-profile.client';
import { createM3ActiveVehicleLookup } from './m3-vehicle.client';

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
  const m3ConductorBaseUrl = process.env.M3_CONDUCTOR_BASE_URL?.trim();
  const m3VehiclesBaseUrl = process.env.M3_VEHICLES_BASE_URL?.trim();
  const runtime: Rf81Application = createRf81Application({
    databaseUrl,
    driverNameLookup: m3ConductorBaseUrl ? createM3DriverNameLookup(m3ConductorBaseUrl) : undefined,
    activeVehicleLookup: m3VehiclesBaseUrl ? createM3ActiveVehicleLookup(m3VehiclesBaseUrl) : undefined,
  });
  // El Inbox es infraestructura de RF8.6 y usa CommunicationsDB, nunca datos de M3.
  const messagingPool = createNotificationsPool(databaseUrl);
  let available = false;
  let closing = false;
  let retryTimer: NodeJS.Timeout | undefined;
  let m3RetryTimer: NodeJS.Timeout | undefined;
  let m3Starting = false;
  let m3Connection: RabbitMqConnection | undefined;
  let m3Consumer: M3DriverDocumentRegisteredConsumer | undefined;
  let m6Consumer: M6TripEventsConsumer | undefined;
  let m5Consumer: M5TripEventsConsumer | undefined;
  let outboxChannel: Awaited<ReturnType<RabbitMqConnection['createConfirmChannel']>> | undefined;
  let outboxRelay: NotificationOutboxRelay | undefined;

  const scheduleM3Retry = () => {
    if (closing || m3RetryTimer) return;
    m3RetryTimer = setTimeout(() => {
      m3RetryTimer = undefined;
      void startM3DocumentConsumer();
    }, 3000);
  };

  const startM3DocumentConsumer = async (): Promise<void> => {
    if (closing || m3Starting || (m3Consumer?.isReady() && m5Consumer?.isReady() && m6Consumer?.isReady())) return;
    const rabbitUrl = process.env.RABBITMQ_URL;
    if (rabbitUrl === undefined || rabbitUrl.trim() === '') {
      console.warn('[RF8.6] RABBITMQ_URL no está configurada; el consumer M3 queda detenido.');
      return;
    }

    m3Starting = true;
    try {
      m3Connection = await amqp.connect(rabbitUrl);
      const activeConnection = m3Connection;
      if (closing) {
        await activeConnection.close();
        return;
      }
      const disconnected = () => {
        if (m3Connection !== activeConnection) return;
        outboxRelay?.stop();
        outboxRelay = undefined;
        outboxChannel = undefined;
        m3Consumer = undefined;
        m6Consumer = undefined;
        m5Consumer = undefined;
        m3Connection = undefined;
        void activeConnection.close().catch(() => undefined);
        scheduleM3Retry();
      };
      activeConnection.on?.('close', disconnected);
      activeConnection.on?.('error', (error: unknown) => {
        if (!closing) console.warn('[RF8.6] Error en la conexión RabbitMQ.', error);
      });
      m3Consumer = new M3DriverDocumentRegisteredConsumer({
        connection: m3Connection,
        inboxStore: new PostgresTechnicalInbox(messagingPool),
        deliverToRf81: (value) => runtime.processDriverDocumentRegisteredEvent(value),
        onDisconnected: disconnected,
      });
      await m3Consumer.start();
      if (closing || m3Connection !== activeConnection) return;
      m6Consumer = new M6TripEventsConsumer({
        connection: m3Connection,
        inboxStore: new PostgresTechnicalInbox(messagingPool),
        deliverToRf81: (value) => runtime.processTripEventEnvelope(value),
        onDisconnected: disconnected,
      });
      await m6Consumer.start();
      if (closing || m3Connection !== activeConnection) return;
      m5Consumer = new M5TripEventsConsumer({
        connection: m3Connection,
        inboxStore: new PostgresTechnicalInbox(messagingPool),
        deliverToRf81: (value) => runtime.processM5EventEnvelope(value),
        onDisconnected: disconnected,
      });
      await m5Consumer.start();
      if (closing || m3Connection !== activeConnection) return;
      outboxChannel = await m3Connection.createConfirmChannel();
      outboxChannel.on?.('close', disconnected);
      outboxChannel.on?.('error', (error: unknown) => {
        if (!closing) console.warn('[RF8.6] Error en el canal Outbox.', error);
      });
      await outboxChannel.assertExchange('mobility.events', 'topic', { durable: true });
      outboxRelay = new NotificationOutboxRelay(messagingPool, runtime.outbox, outboxChannel);
      outboxRelay.start();
    } catch (error) {
      outboxRelay?.stop();
      await outboxChannel?.close().catch(() => undefined);
      await m3Consumer?.stop().catch(() => undefined);
      await m6Consumer?.stop().catch(() => undefined);
      await m5Consumer?.stop().catch(() => undefined);
      await m3Connection?.close().catch(() => undefined);
      outboxRelay = undefined;
      outboxChannel = undefined;
      m3Consumer = undefined;
      m6Consumer = undefined;
      m5Consumer = undefined;
      m3Connection = undefined;
      if (!closing) {
        console.warn('[RF8.6] No se pudo iniciar el consumer M3; se reintentará.', error);
        scheduleM3Retry();
      }
    } finally {
      m3Starting = false;
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
      return { status: available && m3Consumer?.isReady() && m5Consumer?.isReady() && m6Consumer?.isReady() && outboxRelay?.isReady() && m3Connection ? 'ok' : 'unavailable' };
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
      await m6Consumer?.stop();
      await m5Consumer?.stop();
      await m3Connection?.close().catch(() => undefined);
      await runtime.close();
      await messagingPool.end();
    },
  };
}
