import type { PrismaClient } from '@prisma/client';

import { parseEventEnvelope } from '../messaging/event-envelope.js';
import type { OutboxMessage, OutboxRepository } from '../messaging/outbox.repository.js';

export class PrismaOutboxRepository implements OutboxRepository {
  public constructor(private readonly prisma: PrismaClient) {}

  public async findPending(limit: number): Promise<OutboxMessage[]> {
    const messages = await this.prisma.outboxEvent.findMany({
      where: { status: 'PENDING', nextAttemptAt: { lte: new Date() } },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });
    return messages.map((message) => ({
      id: message.id,
      routingKey: message.routingKey,
      event: parseEventEnvelope(message.payload),
      status: message.status,
      attempts: message.attempts,
    }));
  }

  public async markPublished(id: string): Promise<void> {
    await this.prisma.outboxEvent.updateMany({
      where: { id, status: 'PENDING' },
      data: { status: 'PUBLISHED', publishedAt: new Date(), lastError: null },
    });
  }

  public async markFailed(id: string, error: string): Promise<void> {
    await this.prisma.outboxEvent.updateMany({
      where: { id, status: 'PENDING' },
      data: { status: 'FAILED', attempts: { increment: 1 }, lastError: error },
    });
  }

  public async scheduleRetry(id: string, nextAttemptAt: Date, error: string): Promise<void> {
    await this.prisma.outboxEvent.updateMany({
      where: { id, status: 'PENDING' },
      data: { attempts: { increment: 1 }, nextAttemptAt, lastError: error },
    });
  }
}
