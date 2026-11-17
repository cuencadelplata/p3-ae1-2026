export interface ProcessedEventRepository {
  hasProcessed(eventId: string): Promise<boolean>;
  markProcessed(eventId: string): Promise<void>;
}

export class IdempotentEventHandler {
  public constructor(private readonly repository: ProcessedEventRepository) {}

  public async handle(eventId: string, action: () => Promise<void>): Promise<boolean> {
    if (await this.repository.hasProcessed(eventId)) return false;
    await action();
    await this.repository.markProcessed(eventId);
    return true;
  }
}
