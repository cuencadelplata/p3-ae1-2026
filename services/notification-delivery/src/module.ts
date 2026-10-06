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

export function createDeliveryModule() {
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
  let consumer: RabbitMqDeliveryConsumer | undefined;

  const readiness = async () => {
    const postgres = await isPostgresReady(pool);
    const rabbitmq = consumer?.isReady() ?? false;
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
      void (async () => {
        try {
          connection = await amqp.connect(
            process.env.RABBITMQ_URL ?? 'amqp://guest:guest@localhost:5672',
          );
          consumer = new RabbitMqDeliveryConsumer({
            connection,
            inboxStore: new PostgresTechnicalInbox(pool),
            deliveryService: service,
          });
          await consumer.start();
        } catch {
          // RabbitMQ es una dependencia degradable: el readiness lo informa sin derribar M8.
        }
      })();
    },
    async stop() {
      await consumer?.stop();
      await connection?.close();
      await closePgPool();
    },
  };
}
