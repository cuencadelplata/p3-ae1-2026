import type * as amqp from 'amqplib';
import {
  assertTopology,
  buildQueueTopology,
  EventConsumer,
  NonRetryableMessagingError,
  type EventEnvelope,
  type TechnicalInboxStore,
} from '@m8/shared';

import type { DeliveryRepository } from '../database/delivery.repository.js';
import type { EmailSender } from '../provider/smtp-email-sender.js';
import { StructuredLogger } from '../logging/logger.js';

/**
 * RF-1.4 de M1 delega en M8 el correo de recuperación de contraseña: M1 publica
 * auth.recuperacion_solicitada en su exchange m1.eventos con el email, el nombre
 * y el token, y M8 lo envía por correo.
 */
export const M1_EVENTS_EXCHANGE = 'm1.eventos';
export const PASSWORD_RECOVERY_ROUTING_KEY = 'auth.recuperacion_solicitada';
export const PASSWORD_RECOVERY_QUEUE = 'm8.delivery.password-recovery';
const EVENT_TYPE = 'PasswordRecoveryRequested';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface PasswordRecoveryData {
  userId: number;
  email: string;
  nombre: string;
  token: string;
  expiraEnSegundos: number;
}

/** Convierte el mensaje de M1 ({ id, evento, modulo, fecha, datos }) al sobre de M8. */
export function parsePasswordRecoveryEvent(content: Buffer, routingKey?: string): EventEnvelope<PasswordRecoveryData> {
  let raw: any;
  try {
    raw = JSON.parse(content.toString('utf8'));
  } catch {
    throw new NonRetryableMessagingError('El evento de M1 no es JSON válido.');
  }
  // RabbitMQ devuelve los reintentos por el exchange por defecto, con el
  // nombre de la cola como routing key. El evento de M1 conserva su tipo.
  const isRecoveryRoute = routingKey === PASSWORD_RECOVERY_ROUTING_KEY || routingKey === PASSWORD_RECOVERY_QUEUE;
  if (!isRecoveryRoute || raw?.evento !== PASSWORD_RECOVERY_ROUTING_KEY) {
    throw new NonRetryableMessagingError('El evento no es auth.recuperacion_solicitada.');
  }
  if (raw.modulo !== 'M1' || typeof raw.id !== 'string' || !UUID_PATTERN.test(raw.id)) {
    throw new NonRetryableMessagingError('El evento debe venir de M1 con un id UUID.');
  }
  const datos = raw.datos ?? {};
  if (!Number.isSafeInteger(datos.userId) || datos.userId < 1 || typeof datos.email !== 'string' ||
      !EMAIL_PATTERN.test(datos.email) || typeof datos.token !== 'string' || datos.token.length < 16) {
    throw new NonRetryableMessagingError('auth.recuperacion_solicitada requiere userId, email y token válidos.');
  }
  return {
    messageId: raw.id,
    eventType: EVENT_TYPE,
    version: 1,
    occurredAt: typeof raw.fecha === 'string' ? raw.fecha : new Date().toISOString(),
    correlationId: raw.id,
    producer: 'm1',
    data: {
      userId: datos.userId,
      email: datos.email,
      nombre: typeof datos.nombre === 'string' && datos.nombre.trim() ? datos.nombre.trim() : 'usuario',
      token: datos.token,
      expiraEnSegundos: Number.isFinite(datos.expiraEnSegundos) ? datos.expiraEnSegundos : 900,
    },
  };
}

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);

export function buildPasswordRecoveryEmail(data: PasswordRecoveryData) {
  const minutes = Math.max(1, Math.round(data.expiraEnSegundos / 60));
  const subject = 'Recuperación de contraseña - Movilidad Urbana';
  const text = [
    `Hola ${data.nombre}:`,
    '',
    'Recibimos un pedido para recuperar la contraseña de tu cuenta.',
    `Tu código de recuperación es: ${data.token}`,
    '',
    `Ingresalo en la pantalla de recuperación junto con tu contraseña nueva. Vence en ${minutes} minutos y sirve una sola vez.`,
    'Si no lo pediste, ignorá este correo: tu contraseña no cambia.',
  ].join('\n');
  const html = `<p>Hola ${escapeHtml(data.nombre)}:</p>
<p>Recibimos un pedido para recuperar la contraseña de tu cuenta.</p>
<p>Tu código de recuperación es:</p>
<p style="font-family:monospace;font-size:14px;word-break:break-all;background:#f3f4f6;padding:12px;border-radius:6px">${escapeHtml(data.token)}</p>
<p>Ingresalo en la pantalla de recuperación junto con tu contraseña nueva. Vence en ${minutes} minutos y sirve una sola vez.</p>
<p>Si no lo pediste, ignorá este correo: tu contraseña no cambia.</p>`;
  return { subject, text, html };
}

export interface PasswordRecoveryEmailConsumerOptions {
  connection: amqp.ChannelModel;
  inboxStore: TechnicalInboxStore;
  deliveryRepo: DeliveryRepository;
  emailSender: EmailSender;
  onDisconnected?: () => void;
  maxRetries?: number;
  retryDelayMs?: number;
}

export class PasswordRecoveryEmailConsumer {
  private channel?: amqp.ConfirmChannel;
  private consumer?: EventConsumer;
  private running = false;

  constructor(private readonly options: PasswordRecoveryEmailConsumerOptions) {}

  async start(): Promise<void> {
    if (this.running) return;
    const channel = await this.options.connection.createConfirmChannel();
    let channelClosed = false;
    channel.on('close', () => {
      channelClosed = true;
      this.running = false;
      this.options.onDisconnected?.();
    });
    channel.on('error', (error: unknown) => console.warn('[RF8.7] Error en el canal de correos de M1.', error));

    const topology = buildQueueTopology({
      exchange: M1_EVENTS_EXCHANGE,
      queue: PASSWORD_RECOVERY_QUEUE,
      routingKey: PASSWORD_RECOVERY_ROUTING_KEY,
    });
    // La cola se declara aunque falte SMTP: los pedidos de M1 esperan en ella.
    await assertTopology(channel, topology);
    this.channel = channel;

    if (!this.options.emailSender.isConfigured()) {
      console.warn('[RF8.7] SMTP sin configurar: los correos de recuperación de M1 quedan en la cola m8.delivery.password-recovery.');
      this.running = true;
      return;
    }

    const consumer = new EventConsumer({
      consumerId: PASSWORD_RECOVERY_QUEUE,
      topology,
      inboxStore: this.options.inboxStore,
      maxRetries: this.options.maxRetries ?? 3,
      retryDelayMs: this.options.retryDelayMs ?? 10_000,
      parseEvent: parsePasswordRecoveryEvent,
    });
    consumer.registerHandler<PasswordRecoveryData>(EVENT_TYPE, (envelope) => this.deliver(envelope));
    await consumer.start(channel);
    if (channelClosed) throw new Error('El canal se cerró durante el arranque del consumer de correos de M1.');
    this.consumer = consumer;
    this.running = true;
  }

  private async deliver(envelope: EventEnvelope<PasswordRecoveryData>): Promise<void> {
    const { messageId, data } = envelope;
    const existing = await this.options.deliveryRepo.getByMessageId(messageId);
    if (existing?.status === 'DELIVERED') return;

    const email = buildPasswordRecoveryEmail(data);
    // El token y el email no se guardan: solo queda constancia de la entrega.
    const record = existing ?? await this.options.deliveryRepo.createDelivery({
      notificationId: messageId,
      messageId,
      userId: data.userId,
      eventType: 'PASSWORD_RECOVERY',
      channel: 'EMAIL',
      title: email.subject,
      message: 'Correo con el código de recuperación de contraseña de M1.',
    });

    const attemptNumber = (existing?.attempts.length ?? 0) + 1;
    const startedAt = Date.now();
    try {
      const sent = await this.options.emailSender.send({ to: data.email, ...email });
      await this.options.deliveryRepo.recordAttempt({
        deliveryId: record.deliveryId,
        attemptNumber,
        status: 'SUCCESS',
        providerResponse: sent.messageId,
        latencyMs: Date.now() - startedAt,
      });
      await this.options.deliveryRepo.updateStatus(record.deliveryId, 'DELIVERED');
      StructuredLogger.info({
        event: 'EMAIL_DELIVERY_SUCCESS',
        messageId,
        userId: String(data.userId),
        result: 'DELIVERED',
        latencyMs: Date.now() - startedAt,
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      await this.options.deliveryRepo.recordAttempt({
        deliveryId: record.deliveryId,
        attemptNumber,
        status: 'FAILED',
        errorMessage: reason,
        latencyMs: Date.now() - startedAt,
      });
      await this.options.deliveryRepo.updateStatus(record.deliveryId, 'FAILED');
      StructuredLogger.warn({ event: 'EMAIL_ATTEMPT_FAILED', messageId, userId: String(data.userId), error: reason });
      // Se reintenta desde la cola; agotados los intentos, va a la DLQ.
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (!this.channel) return;
    if (this.consumer) await this.consumer.stop(this.channel).catch(() => undefined);
    await this.channel.close().catch(() => undefined);
    this.channel = undefined;
    this.consumer = undefined;
    this.running = false;
  }

  isReady(): boolean {
    return this.running;
  }
}
