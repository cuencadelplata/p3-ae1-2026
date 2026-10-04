import type { OutboxProcessor } from './outbox.processor.js';

export class OutboxWorker {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  public constructor(
    private readonly processor: OutboxProcessor,
    private readonly intervalMs: number,
    private readonly onError: (error: unknown) => void,
  ) {}

  public start(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
    void this.tick();
  }

  public stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.processor.process();
    } catch (error) {
      this.onError(error);
    } finally {
      this.running = false;
    }
  }
}
