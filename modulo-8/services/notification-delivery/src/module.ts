import * as amqp from 'amqplib';
import { PostgresTechnicalInbox } from '@m8/shared';
import { createDeliveryRouter } from './http/delivery.router.js';
import { closePgPool, getPgPool, isPostgresReady } from './infrastructure/database/pg-client.js';
import { PgDeviceTokenRepository } from './infrastructure/database/device-token.repository.js';
import { PgDeliveryRepository } from './infrastructure/database/delivery.repository.js';
import { PgMessagingInboxRepository } from './infrastructure/database/inbox.repository.js';
import { HttpM2PreferencesClient } from './infrastructure/clients/m2-preferences.client.js';
import { RabbitMqDeliveryConsumer } from './infrastructure/messaging/rabbitmq-delivery-consumer.js';
import { SandboxPushProvider } from './infrastructure/provider/sandbox-push-provider.js';
import { NotificationDeliveryService } from './services/notification-delivery.service.js';

interface DeliveryConsumerLifecycle {
  start(): Promise<void>;
  stop(): Promise<void>;
  isReady(): boolean;
}

export interface DeliveryModuleOptions {
  connectRabbitMq?: (url: string) => Promise<amqp.ChannelModel>;
  createConsumer?: (connection: amqp.ChannelModel, service: NotificationDeliveryService, pool: ReturnType<typeof getPgPool>, onDisconnected: () => void) => DeliveryConsumerLifecycle;
  retryDelayMs?: number;
}

export function createDeliveryModule(options: DeliveryModuleOptions = {}) {
  const pool = getPgPool();
  const tokens = new PgDeviceTokenRepository(pool);
  const deliveries = new PgDeliveryRepository(pool);
  const inbox = new PgMessagingInboxRepository(pool);
  const provider = new SandboxPushProvider();
  const preferences = new HttpM2PreferencesClient(
    process.env.M2_API_URL ?? 'http://localhost:3002',
    process.env.M2_INTERNAL_API_KEY ?? '',
    Number(process.env.M2_TIMEOUT_MS ?? 3000),
  );
  const service = new NotificationDeliveryService(inbox, deliveries, tokens, preferences, provider);
  let connection: amqp.ChannelModel | undefined;
  let consumer: DeliveryConsumerLifecycle | undefined;
  let retryTimer: NodeJS.Timeout | undefined;
  let starting = false;
  let closing = false;

  const scheduleRetry = () => {
    if (closing || retryTimer) return;
    retryTimer = setTimeout(() => {
      retryTimer = undefined;
      void connectConsumer();
    }, options.retryDelayMs ?? 3000);
  };

  const connectConsumer = async () => {
    if (closing || starting || consumer?.isReady()) return;
    const rabbitUrl = process.env.RABBITMQ_URL;
    if (!rabbitUrl?.trim()) {
      console.warn('[RF8.7] RABBITMQ_URL no está configurada; el consumer queda detenido.');
      return;
    }
    starting = true;
    let nextConnection: amqp.ChannelModel | undefined;
    try {
      nextConnection = await (options.connectRabbitMq ?? amqp.connect)(rabbitUrl);
      if (closing) {
        await nextConnection.close();
        return;
      }
      const activeConnection = nextConnection;
      connection = activeConnection;
      activeConnection.on('error', (error) => {
        if (!closing) console.warn('[RF8.7] Error en RabbitMQ.', error);
      });
      activeConnection.on('close', () => {
        if (connection !== activeConnection) return;
        connection = undefined;
        consumer = undefined;
        scheduleRetry();
      });
      const onDisconnected = () => {
        if (connection !== activeConnection) return;
        connection = undefined;
        consumer = undefined;
        void activeConnection.close().catch(() => undefined);
        scheduleRetry();
      };
      const nextConsumer = options.createConsumer?.(activeConnection, service, pool, onDisconnected)
        ?? new RabbitMqDeliveryConsumer({
          connection: activeConnection,
          inboxStore: new PostgresTechnicalInbox(pool),
          deliveryService: service,
          onDisconnected,
        });
      await nextConsumer.start();
      if (closing || connection !== activeConnection) {
        await nextConsumer.stop();
        return;
      }
      consumer = nextConsumer;
    } catch (error) {
      if (!closing) console.warn('[RF8.7] No se pudo iniciar el consumer; se reintentará.', error);
      if (connection === nextConnection) connection = undefined;
      await nextConnection?.close().catch(() => undefined);
      scheduleRetry();
    } finally {
      starting = false;
    }
  };

  const readiness = async () => {
    const postgres = await isPostgresReady(pool);
    const rabbitmq = Boolean(connection && consumer?.isReady());
    return {
      ok: postgres && rabbitmq,
      checks: {
        postgres: postgres ? 'ok' : 'down',
        rabbitmq: rabbitmq ? 'ok' : 'down',
        pushProvider: 'ok',
        m2_preferences: 'degraded',
      },
    };
  };

  return {
    name: 'delivery' as const,
    router: createDeliveryRouter({
      deliveryService: service,
      tokenRepo: tokens,
      inboxRepo: inbox,
      deliveryRepo: deliveries,
      sandboxProvider: provider,
      isReady: readiness,
    }),
    async readiness() {
      const result = await readiness();
      return { status: result.ok ? ('ok' as const) : ('unavailable' as const), checks: result.checks };
    },
    start() {
      void connectConsumer();
    },
    async stop() {
      closing = true;
      if (retryTimer) clearTimeout(retryTimer);
      await consumer?.stop();
      await connection?.close().catch(() => undefined);
      await closePgPool();
    },
  };
}
