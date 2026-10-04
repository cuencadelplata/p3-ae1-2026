import { createClient } from 'redis';

export type RedisClient = ReturnType<typeof createClient>;

export class RedisConnection {
  public readonly client: RedisClient;

  public constructor(url: string, onError: (error: unknown) => void = console.error) {
    this.client = createClient({ url });
    this.client.on('error', onError);
  }

  public async connect(): Promise<void> {
    if (!this.client.isOpen) await this.client.connect();
  }

  public async ping(): Promise<boolean> {
    if (!this.client.isReady) return false;
    return (await this.client.ping()) === 'PONG';
  }

  public async close(): Promise<void> {
    if (this.client.isOpen) await this.client.quit();
  }
}
