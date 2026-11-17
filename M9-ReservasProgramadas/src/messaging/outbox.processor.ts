import { ROOT_CONTEXT, trace } from '@opentelemetry/api';

import {
  now,
  recordOutboxBatch,
  recordOutboxFailure,
  recordOutboxPublished,
} from '../observability/metrics.js';
import {
  extractTraceContext,
  markSpanError,
  SpanKind,
  withSpan,
} from '../observability/tracing.js';
import type { EventPublisher } from './event-publisher.js';
import type { OutboxMessage, OutboxRepository } from './outbox.repository.js';

export class OutboxProcessor {
  public constructor(
    private readonly repository: OutboxRepository,
    private readonly publisher: EventPublisher,
    private readonly retryLimit: number,
    private readonly retryDelayMs: number,
  ) {}

  /**
   * Cada ciclo es una traza nueva (`outbox.process_batch`). Cada evento se publica en un span
   * PRODUCER cuyo padre es el contexto guardado al crear el evento (la transacción original),
   * con un enlace al ciclo que lo publicó. Eventos sin contexto (previos a AE4) inician traza.
   */
  public async process(limit = 100): Promise<void> {
    await withSpan(
      'outbox.process_batch',
      async (batchSpan) => {
        const startMs = now();
        const pending = await this.repository.findPending(limit);
        batchSpan.setAttribute('m9.outbox.batch_size', pending.length);
        const batchLink = { context: batchSpan.spanContext() };
        for (const message of pending) {
          await withSpan(`publish ${message.event.eventType}`, () => this.publishOne(message), {
            kind: SpanKind.PRODUCER,
            parent: extractTraceContext(message.traceContext, ROOT_CONTEXT),
            links: trace.isSpanContextValid(batchLink.context) ? [batchLink] : [],
            attributes: {
              'messaging.system': 'rabbitmq',
              'messaging.operation.type': 'send',
              'messaging.message.id': message.event.eventId,
              'm9.event_type': message.event.eventType,
              'm9.correlation_id': message.event.correlationId,
              'm9.outbox.attempts': message.attempts,
            },
          });
        }
        recordOutboxBatch(startMs, pending.length);
      },
      { root: true },
    );
  }

  private async publishOne(message: OutboxMessage): Promise<void> {
    try {
      await this.publisher.publish(message.routingKey, message.event);
      await this.repository.markPublished(message.id);
      recordOutboxPublished(message.event.eventType);
    } catch (error) {
      const safeError = this.safeError(error);
      if (message.attempts + 1 >= this.retryLimit) {
        try {
          await this.publisher.publishToDeadLetter(message.routingKey, message.event);
          await this.repository.markFailed(message.id, safeError);
          recordOutboxFailure(message.event.eventType, 'dead_lettered');
        } catch (deadLetterError) {
          await this.repository.scheduleRetry(
            message.id,
            this.nextAttempt(message.attempts),
            this.safeError(deadLetterError),
          );
          recordOutboxFailure(message.event.eventType, 'dead_letter_failed');
        }
      } else {
        await this.repository.scheduleRetry(
          message.id,
          this.nextAttempt(message.attempts),
          safeError,
        );
        recordOutboxFailure(message.event.eventType, 'retry_scheduled');
      }
      // El span refleja la falla aunque el ciclo continúe con el próximo evento. Los errores
      // del repositorio (p. ej. PostgreSQL caído) sí se propagan, como antes de AE4.
      const span = trace.getActiveSpan();
      if (span !== undefined) markSpanError(span, error);
    }
  }

  private safeError(error: unknown): string {
    return error instanceof Error ? error.name : 'UNKNOWN_ERROR';
  }

  private nextAttempt(currentAttempts: number): Date {
    const multiplier = 2 ** Math.min(currentAttempts, 6);
    return new Date(Date.now() + this.retryDelayMs * multiplier);
  }
}
