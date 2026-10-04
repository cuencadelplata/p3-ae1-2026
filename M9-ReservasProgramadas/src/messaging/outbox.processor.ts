import type { EventPublisher } from './event-publisher.js';
import type { OutboxRepository } from './outbox.repository.js';

export class OutboxProcessor {
  public constructor(
    private readonly repository: OutboxRepository,
    private readonly publisher: EventPublisher,
    private readonly retryLimit: number,
    private readonly retryDelayMs: number,
  ) {}

  public async process(limit = 100): Promise<void> {
    const pending = await this.repository.findPending(limit);
    for (const message of pending) {
      try {
        await this.publisher.publish(message.routingKey, message.event);
        await this.repository.markPublished(message.id);
      } catch (error) {
        const safeError = this.safeError(error);
        if (message.attempts + 1 >= this.retryLimit) {
          try {
            await this.publisher.publishToDeadLetter(message.routingKey, message.event);
            await this.repository.markFailed(message.id, safeError);
          } catch (deadLetterError) {
            await this.repository.scheduleRetry(
              message.id,
              this.nextAttempt(message.attempts),
              this.safeError(deadLetterError),
            );
          }
        } else {
          await this.repository.scheduleRetry(
            message.id,
            this.nextAttempt(message.attempts),
            safeError,
          );
        }
      }
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
