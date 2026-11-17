import type { EventEnvelope } from './event-envelope.js';

export interface OutboxMessage {
  id: string;
  routingKey: string;
  event: EventEnvelope;
  status: 'PENDING' | 'PUBLISHED' | 'FAILED';
  attempts: number;
  /** Contexto W3C persistido al crear el evento; `null`/ausente en eventos previos a AE4. */
  traceContext?: Record<string, string> | null;
}

export interface OutboxRepository {
  findPending(limit: number): Promise<OutboxMessage[]>;
  markPublished(id: string): Promise<void>;
  markFailed(id: string, error: string): Promise<void>;
  scheduleRetry(id: string, nextAttemptAt: Date, error: string): Promise<void>;
}
