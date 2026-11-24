import * as amqp from 'amqplib';
import { PostgresTechnicalInbox } from '@m8/shared';
import { createM1IdentityCheck } from './http/auth/m1-auth.middleware.js';
import { createDeliveryRouter } from './http/delivery.router.js';
import { closePgPool, getPgPool, isPostgresReady } from './infrastructure/database/pg-client.js';
import { PgDeviceTokenRepository } from './infrastructure/database/device-token.repository.js';
import { PgDeliveryRepository } from './infrastructure/database/delivery.repository.js';
import { PgMessagingInboxRepository } from './infrastructure/database/inbox.repository.js';
import { CircuitBreakerM2PreferencesClient, HttpM2PreferencesClient } from './infrastructure/clients/m2-preferences.client.js';
import { PasswordRecoveryEmailConsumer } from './infrastructure/messaging/password-recovery-email.consumer.js';
import { RabbitMqDeliveryConsumer } from './infrastructure/messaging/rabbitmq-delivery-consumer.js';
import { SmtpEmailSender } from './infrastructure/provider/smtp-email-sender.js';
import { WebPushProvider } from './infrastructure/provider/web-push-provider.js';
import { NotificationDeliveryService } from './services/notification-delivery.service.js';

/**
 * Una suscripción Web Push serializada supera los 255 caracteres de la tabla
 * original. El rol de entrega es dueño de sus tablas y las amplía al arrancar.
 */
async function widenDeviceTokenColumns(pool: ReturnType<typeof getPgPool>): Promise<void> {
  await pool.query('ALTER TABLE notification_delivery.device_tokens ALTER COLUMN token TYPE TEXT');
  await pool.query('ALTER TABLE notification_delivery.delivery_requests ALTER COLUMN device_token TYPE TEXT');
}

/** Corre el consumer de entregas y el de correos de M1 sobre la misma conexión. */
function combineConsumers(...consumers: DeliveryConsumerLifecycle[]): DeliveryConsumerLifecycle {
  return {
    async start() {
      for (const consumer of consumers) await consumer.start();
    },
    async stop() {
      await Promise.all(consumers.map((consumer) => consumer.stop()));
    },
    isReady() {
      return consumers.every((consumer) => consumer.isReady());
    },
  };
}

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
  const provider = new WebPushProvider();
  const emailSender = new SmtpEmailSender();
  let schemaReady = false;
  const ensureSchema = async () => {
    if (schemaReady) return;
    await widenDeviceTokenColumns(pool);
    schemaReady = true;
  };
  const preferences = new CircuitBreakerM2PreferencesClient(new HttpM2PreferencesClient(
    process.env.M2_API_URL ?? 'http://localhost:3002',
    process.env.M2_INTERNAL_API_KEY ?? '',
    Number(process.env.M2_TIMEOUT_MS ?? 3000),
  ));
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
      if (!options.createConsumer) await ensureSchema();
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
        ?? combineConsumers(
          new RabbitMqDeliveryConsumer({
            connection: activeConnection,
            inboxStore: new PostgresTechnicalInbox(pool),
            deliveryService: service,
            onDisconnected,
          }),
          new PasswordRecoveryEmailConsumer({
            connection: activeConnection,
            inboxStore: new PostgresTechnicalInbox(pool),
            deliveryRepo: deliveries,
            emailSender,
            onDisconnected,
          }),
        );
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
        // Proveedores externos reales: si falta su configuración se informa, sin frenar la app.
        pushProvider: provider.isConfigured() ? 'ok' : 'not_configured',
        emailProvider: emailSender.isConfigured() ? 'ok' : 'not_configured',
        // M2 no ofrece un health acordado; su disponibilidad se comprueba al pedir preferencias.
        m2_preferences: 'not_checked',
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
      webPush: {
        publicKey: provider.publicKey(),
        m1PublicUrl: (process.env.PUSH_M1_PUBLIC_URL ?? 'http://localhost:10000').replace(/\/+$/, ''),
      },
      // M1_IDENTITY_URL es el endpoint completo de validación (el mismo que usan comprobantes).
      identityCheck: process.env.M1_IDENTITY_URL?.trim()
        ? createM1IdentityCheck(process.env.M1_IDENTITY_URL.trim(), Number(process.env.M1_TIMEOUT_MS ?? 3000))
        : undefined,
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
