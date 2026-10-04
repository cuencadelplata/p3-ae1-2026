import { randomUUID } from 'node:crypto';

import { z } from 'zod';

export interface EventEnvelope<TPayload = unknown> {
  eventId: string;
  eventType: string;
  eventVersion: number;
  occurredAt: string;
  correlationId: string;
  aggregateId: string;
  payload: TPayload;
}

export const eventEnvelopeSchema = z.object({
  eventId: z.string().uuid(),
  eventType: z.string().min(1),
  eventVersion: z.number().int().positive(),
  occurredAt: z.string().datetime({ offset: true }),
  correlationId: z.string().min(1),
  aggregateId: z.string().uuid(),
  payload: z.unknown(),
});

export const parseEventEnvelope = (value: unknown): EventEnvelope =>
  eventEnvelopeSchema.parse(value);

export const createEventEnvelope = <TPayload>(input: {
  eventType: string;
  correlationId: string;
  aggregateId: string;
  payload: TPayload;
  eventVersion?: number;
}): EventEnvelope<TPayload> => ({
  eventId: randomUUID(),
  eventType: input.eventType,
  eventVersion: input.eventVersion ?? 1,
  occurredAt: new Date().toISOString(),
  correlationId: input.correlationId,
  aggregateId: input.aggregateId,
  payload: input.payload,
});
