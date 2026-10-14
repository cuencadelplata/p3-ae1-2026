import type { Channel, ChannelModel } from 'amqplib';
import { Pool, type PoolClient } from 'pg';
import { publishWithConfirm } from './consumer';
import type { EventEnvelope } from './envelope';
import type { OutboxEntry, OutboxStore } from './outbox';
import { MAIN_EXCHANGE } from './topology';

export const NOTIFICATION_REQUESTED_EVENT_TYPE = 'NotificationRequested';
export const NOTIFICATION_REQUESTED_ROUTING_KEY = 'notification.requested';
export const NOTIFICATION_REQUESTED_VERSION = 1;
export const NOTIFICATIONS_PRODUCER = 'm8-notifications';

export interface NotificationOutboxRow {
  message_id: string;
  notification_id: string;
  event_type: string;
  routing_key: string;
  correlation_id: string;
  version: number;
  producer: string;
  payload: Record<string, unknown>;
  created_at: Date;
  published_at: Date | null;
}

export function mapNotificationOutboxRowToEnvelope(row: NotificationOutboxRow): EventEnvelope {
  return {
    messageId: row.message_id,
    eventType: row.event_type || NOTIFICATION_REQUESTED_EVENT_TYPE,
    version: row.version || NOTIFICATION_REQUESTED_VERSION,
    occurredAt: row.created_at.toISOString(),
    correlationId: row.correlation_id,
    producer: row.producer || NOTIFICATIONS_PRODUCER,
    data: row.payload,
  };
}

export function mapNotificationOutboxRowToEntry(row: NotificationOutboxRow): OutboxEntry {
  return {
    id: row.message_id,
    eventType: row.event_type || NOTIFICATION_REQUESTED_EVENT_TYPE,
    payload: mapNotificationOutboxRowToEnvelope(row),
  };
}

/**
 * Adaptador de OutboxStore específico para la tabla notifications.outbox_deliveries de RF8.1.
 * NO afecta a messaging.outbox_events utilizado por otros módulos como Receipts.
 */
export class PostgresNotificationOutboxStore implements OutboxStore {
  constructor(private readonly pool: Pool) {}

  async fetchPending(limit: number = 10): Promise<OutboxEntry[]> {
    const res = await this.pool.query<NotificationOutboxRow>(
      `SELECT message_id, notification_id, event_type, routing_key, correlation_id,
              version, producer, payload, created_at, published_at
         FROM notifications.outbox_deliveries
        WHERE published_at IS NULL
        ORDER BY created_at ASC, message_id ASC
        LIMIT $1`,
      [limit]
    );
    return res.rows.map(mapNotificationOutboxRowToEntry);
  }

  async claimPending(limit: number = 10): Promise<OutboxEntry[]> {
    return this.fetchPending(limit);
  }

  async markAsPublished(id: string): Promise<void> {
    await this.pool.query(
      `UPDATE notifications.outbox_deliveries
          SET published_at = NOW()
        WHERE message_id = $1`,
      [id]
    );
  }

  async markAsFailed(_id: string, _error: string): Promise<void> {
    // notifications.outbox_deliveries no tiene columna error_message: preserva published_at = NULL para reintento
  }
}

export interface NotificationOutboxRelayOptions {
  pool: Pool;
  ownsPool?: boolean;
  connection?: ChannelModel;
  rabbitmqUrl?: string;
  exchange?: string;
  routingKey?: string;
  batchSize?: number;
  pollIntervalMs?: number;
  logger?: {
    info(msg: string, meta?: unknown): void;
    warn(msg: string, meta?: unknown): void;
    error(msg: string, meta?: unknown): void;
  };
}

/**
 * Worker técnico RF8.6 para el relay automático de intenciones de entrega:
 * notifications.outbox_deliveries -> mobility.events / notification.requested -> RF8.7
 *
 * Características:
 * - Exclusión mutua concurrente mediante FOR UPDATE SKIP LOCKED dentro de transacción PostgreSQL.
 * - Publicación con Publisher Confirms antes de confirmar el registro en PostgreSQL.
 * - Resiliencia ante caídas de RabbitMQ: no pierde la intención, no marca published_at, no derriba la aplicación.
 * - Ciclo de vida integrado (start/stop) sin dejar timers, conexiones ni canales abiertos.
 */
export class NotificationOutboxRelay {
  private isRunning = false;
  private isProcessing = false;
  private timer?: NodeJS.Timeout;
  private channel?: Channel;
  private ownsConnection = false;
  private connection?: ChannelModel;
  private readonly pool: Pool;
  private readonly ownsPool: boolean;
  private readonly exchange: string;
  private readonly routingKey: string;
  private readonly batchSize: number;
  private readonly pollIntervalMs: number;
  private readonly logger: NonNullable<NotificationOutboxRelayOptions['logger']>;

  constructor(private readonly options: NotificationOutboxRelayOptions) {
    this.pool = options.pool;
    this.ownsPool = options.ownsPool ?? false;
    this.exchange = options.exchange || MAIN_EXCHANGE;
    this.routingKey = options.routingKey || NOTIFICATION_REQUESTED_ROUTING_KEY;
    this.batchSize = options.batchSize ?? 10;
    this.pollIntervalMs = options.pollIntervalMs ?? 1000;
    this.logger = options.logger ?? {
      info: (msg, meta) => console.log(`[RF8.6][NotificationOutboxRelay] INFO: ${msg}`, meta ?? ''),
      warn: (msg, meta) => console.warn(`[RF8.6][NotificationOutboxRelay] WARN: ${msg}`, meta ?? ''),
      error: (msg, meta) => console.error(`[RF8.6][NotificationOutboxRelay] ERROR: ${msg}`, meta ?? ''),
    };
  }

  async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;

    await this.ensureChannel().catch((err) => {
      this.logger.warn('No se pudo inicializar canal RabbitMQ al inicio. Se reintentará en el ciclo de polling.', { error: err });
    });

    this.scheduleNextPoll(0);
    this.logger.info('NotificationOutboxRelay iniciado.');
  }

  async stop(): Promise<void> {
    this.isRunning = false;
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }

    let waitCount = 0;
    while (this.isProcessing && waitCount < 30) {
      await new Promise((r) => setTimeout(r, 100));
      waitCount++;
    }

    if (this.channel) {
      await this.channel.close().catch(() => {});
      this.channel = undefined;
    }
    if (this.ownsConnection && this.connection) {
      await this.connection.close().catch(() => {});
      this.connection = undefined;
    }
    if (this.ownsPool) {
      await this.pool.end().catch(() => {});
    }
    this.logger.info('NotificationOutboxRelay detenido ordenadamente.');
  }

  private scheduleNextPoll(delayMs: number): void {
    if (!this.isRunning) return;
    this.timer = setTimeout(async () => {
      if (!this.isRunning) return;
      try {
        await this.pollOnce();
      } catch (err) {
        this.logger.error('Error no controlado en ciclo de polling de Outbox', { error: err });
      } finally {
        if (this.isRunning) {
          this.scheduleNextPoll(this.pollIntervalMs);
        }
      }
    }, delayMs);
  }

  private async ensureChannel(): Promise<Channel> {
    if (this.channel) {
      return this.channel;
    }

    if (!this.connection) {
      if (this.options.connection) {
        this.connection = this.options.connection;
        this.ownsConnection = false;
      } else {
        const amqp = await import('amqplib');
        const url = this.options.rabbitmqUrl || process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672';
        this.connection = await amqp.connect(url);
        this.ownsConnection = true;
      }
    }

    const ch = await this.connection.createConfirmChannel();
    await ch.assertExchange(this.exchange, 'topic', { durable: true });
    this.channel = ch;
    return ch;
  }

  /**
   * Ejecuta un ciclo individual de reclamo y publicación segura.
   */
  async pollOnce(): Promise<number> {
    if (this.isProcessing) {
      return 0;
    }
    this.isProcessing = true;

    try {
      let channel: Channel;
      try {
        channel = await this.ensureChannel();
      } catch (err) {
        this.logger.warn('Broker RabbitMQ no disponible para relay de Outbox.', { error: err });
        return 0;
      }

      return await this.publishPendingWithChannel(channel, this.batchSize);
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Publica registros pendientes dentro de una transacción PostgreSQL con FOR UPDATE SKIP LOCKED.
   */
  async publishPendingWithChannel(channel: Channel, limit: number): Promise<number> {
    let client: PoolClient;
    try {
      client = await this.pool.connect();
    } catch (err) {
      this.logger.error('No se pudo obtener cliente de PostgreSQL para Outbox', { error: err });
      return 0;
    }

    try {
      await client.query('BEGIN');

      const result = await client.query<NotificationOutboxRow>(
        `SELECT message_id, notification_id, event_type, routing_key, correlation_id,
                version, producer, payload, created_at, published_at
           FROM notifications.outbox_deliveries
          WHERE published_at IS NULL
          ORDER BY created_at ASC, message_id ASC
          LIMIT $1
          FOR UPDATE SKIP LOCKED`,
        [limit]
      );

      if (result.rows.length === 0) {
        await client.query('ROLLBACK');
        return 0;
      }

      let publishedCount = 0;
      for (const row of result.rows) {
        const envelope = mapNotificationOutboxRowToEnvelope(row);
        const content = Buffer.from(JSON.stringify(envelope));

        await publishWithConfirm(channel, this.exchange, this.routingKey, content, {
          contentType: 'application/json',
          persistent: true,
          messageId: envelope.messageId,
        });

        const publishedAt = new Date().toISOString();
        await client.query(
          `UPDATE notifications.outbox_deliveries
              SET published_at = $2
            WHERE message_id = $1`,
          [row.message_id, publishedAt]
        );
        publishedCount++;
      }

      await client.query('COMMIT');
      if (publishedCount > 0) {
        this.logger.info(`Publicados ${publishedCount} eventos NotificationRequested con Publisher Confirm.`);
      }
      return publishedCount;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      this.logger.warn('Fallo publicando lote de Outbox a RabbitMQ. Transacción abortada para reintento.', { error: err });
      if (
        String((err as Error).message || err).includes('Channel closed') ||
        String((err as Error).message || err).includes('Connection closed') ||
        String((err as Error).message || err).includes('closed')
      ) {
        this.channel = undefined;
      }
      return 0;
    } finally {
      client.release();
    }
  }

  isReady(): boolean {
    return this.isRunning && !!this.channel;
  }
}

export interface CreateNotificationOutboxRelayOptions {
  databaseUrl?: string;
  rabbitmqUrl?: string;
  batchSize?: number;
  pollIntervalMs?: number;
  connection?: ChannelModel;
  logger?: NotificationOutboxRelayOptions['logger'];
}

export function createNotificationOutboxRelay(
  options: CreateNotificationOutboxRelayOptions = {}
): NotificationOutboxRelay {
  const databaseUrl =
    options.databaseUrl ||
    process.env.NOTIFICATIONS_DATABASE_URL ||
    `postgres://m8_notifications:${process.env.NOTIFICATIONS_DB_PASSWORD || 'm8_notifications_local'}@localhost:${process.env.POSTGRES_HOST_PORT || '5432'}/${process.env.POSTGRES_DB || 'm8'}`;
  const pool = new Pool({ connectionString: databaseUrl });
  return new NotificationOutboxRelay({
    pool,
    ownsPool: true,
    connection: options.connection,
    rabbitmqUrl: options.rabbitmqUrl || process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672',
    batchSize: options.batchSize ?? (process.env.OUTBOX_BATCH_SIZE ? Number(process.env.OUTBOX_BATCH_SIZE) : 10),
    pollIntervalMs: options.pollIntervalMs ?? (process.env.OUTBOX_POLL_INTERVAL_MS ? Number(process.env.OUTBOX_POLL_INTERVAL_MS) : 1000),
    logger: options.logger,
  });
}

