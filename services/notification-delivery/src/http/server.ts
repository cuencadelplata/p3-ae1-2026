import http from 'node:http';
import * as amqp from 'amqplib';
import { createApp } from './app.js';
import { getPgPool, closePgPool, isPostgresReady } from '../infrastructure/database/pg-client.js';
import { PgDeviceTokenRepository } from '../infrastructure/database/device-token.repository.js';
import { PgDeliveryRepository } from '../infrastructure/database/delivery.repository.js';
import { PgMessagingInboxRepository } from '../infrastructure/database/inbox.repository.js';
import { PostgresTechnicalInbox } from '@m8/shared';
import { HttpM2PreferencesClient } from '../infrastructure/clients/m2-preferences.client.js';
import { SandboxPushProvider } from '../infrastructure/provider/sandbox-push-provider.js';
import { NotificationDeliveryService } from '../services/notification-delivery.service.js';
import { RabbitMqDeliveryConsumer } from '../infrastructure/messaging/rabbitmq-delivery-consumer.js';

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3107;
const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672';
const M2_API_URL = process.env.M2_API_URL || 'http://localhost:3002';
const M2_INTERNAL_API_KEY = process.env.M2_INTERNAL_API_KEY || 'm8_m2_internal_secret_example';

async function bootstrap() {
  const pgPool = getPgPool();
  const tokenRepo = new PgDeviceTokenRepository(pgPool);
  const deliveryRepo = new PgDeliveryRepository(pgPool);
  const inboxStore = new PostgresTechnicalInbox(pgPool);
  const inboxRepo = new PgMessagingInboxRepository(pgPool);

  const m2Client = new HttpM2PreferencesClient(M2_API_URL, M2_INTERNAL_API_KEY);
  const pushProvider = new SandboxPushProvider();

  const deliveryService = new NotificationDeliveryService(
    inboxRepo,
    deliveryRepo,
    tokenRepo,
    m2Client,
    pushProvider
  );

  let amqpConn: amqp.ChannelModel | null = null;
  let rabbitConsumer: RabbitMqDeliveryConsumer | null = null;

  try {
    amqpConn = await amqp.connect(RABBITMQ_URL);
    rabbitConsumer = new RabbitMqDeliveryConsumer({
      connection: amqpConn,
      inboxStore,
      deliveryService,
    });
    await rabbitConsumer.start();
    console.log(`[RF8.7] Consumidor RabbitMQ conectado y escuchando en cola m8.delivery.notification-requested`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[RF8.7] RabbitMQ no disponible de inmediato (${RABBITMQ_URL}): ${msg}. El servicio continuará en modo degradado.`);
  }

  const isReady = async (): Promise<{ ok: boolean; checks: Record<string, string> }> => {
    const pgOk = await isPostgresReady(pgPool);
    const rmqOk = rabbitConsumer ? rabbitConsumer.isReady() : false;
    return {
      ok: pgOk && rmqOk,
      checks: {
        postgres: pgOk ? 'ok' : 'down',
        rabbitmq: rmqOk ? 'ok' : 'down',
        pushProvider: 'ok',
      },
    };
  };

  const app = createApp({
    deliveryService,
    tokenRepo,
    m2Client,
    sandboxProvider: pushProvider,
    inboxRepo,
    deliveryRepo,
    isReady,
  });

  const server = http.createServer(app);

  server.listen(PORT, () => {
    console.log(`[RF8.7] Servicio de Entrega de Notificaciones escuchando en http://localhost:${PORT}`);
  });

  const shutdown = async () => {
    console.log('[RF8.7] Apagando servicio de forma ordenada...');
    server.close();
    if (rabbitConsumer) {
      await rabbitConsumer.stop().catch(() => {});
    }
    if (amqpConn) {
      await amqpConn.close().catch(() => {});
    }
    await closePgPool().catch(() => {});
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

bootstrap().catch((err) => {
  console.error('[RF8.7] Error fatal durante el arranque del servicio:', err);
  process.exit(1);
});
