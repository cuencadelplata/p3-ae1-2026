import net from 'node:net';
import type { EventStore } from '../../ports/event-store.port.js';
import { Logger } from '../logger/structured.logger.js';

export class RedisEventStore implements EventStore {
  private readonly memoryStore = new Set<string>();
  private readonly host: string;
  private readonly port: number;
  private readonly password?: string;
  private readonly database: number = 0;
  private readonly keyPrefix = 'm4:processed_events:';

  public constructor(redisUrl?: string) {
    if (redisUrl && redisUrl.startsWith('redis://')) {
      const url = new URL(redisUrl);
      this.host = url.hostname || '127.0.0.1';
      this.port = Number(url.port || 6379);
      this.password = url.password ? decodeURIComponent(url.password) : undefined;
      this.database = url.pathname.length > 1 ? Number(url.pathname.slice(1)) : 0;
    } else {
      this.host = '';
      this.port = 0;
    }
  }

  public async isEventProcessed(eventId: string): Promise<boolean> {
    if (this.memoryStore.has(eventId)) {
      return true;
    }

    if (!this.host) {
      return false;
    }

    try {
      const value = await this.command(['GET', `${this.keyPrefix}${eventId}`]);
      return value === '1';
    } catch (error) {
      Logger.warn(`Error al consultar idempotencia en Redis para eventId ${eventId}`, { eventId, error });
      return false;
    }
  }

  public async markEventProcessed(eventId: string, ttlSeconds = 86400): Promise<void> {
    this.memoryStore.add(eventId);

    if (!this.host) {
      return;
    }

    try {
      await this.command([
        'SET',
        `${this.keyPrefix}${eventId}`,
        '1',
        'EX',
        String(ttlSeconds)
      ]);
      Logger.info(`Evento ${eventId} marcado como procesado en Redis (Idempotencia)`, { eventId });
    } catch (error) {
      Logger.error(`Error al marcar idempotencia en Redis para eventId ${eventId}`, error, { eventId });
    }
  }

  private async command(command: string[]): Promise<unknown> {
    const commands: string[][] = [];
    if (this.password) commands.push(['AUTH', this.password]);
    if (this.database > 0) commands.push(['SELECT', String(this.database)]);
    commands.push(command);

    return new Promise((resolve, reject) => {
      const socket = net.createConnection({ host: this.host, port: this.port });
      let buffer = Buffer.alloc(0);

      socket.setTimeout(3_000);
      socket.on('connect', () => {
        socket.write(
          commands
            .map((parts) => `*${parts.length}\r\n${parts.map((p) => `$${Buffer.byteLength(p)}\r\n${p}\r\n`).join('')}`)
            .join('')
        );
      });

      socket.on('data', (chunk) => {
        buffer = Buffer.concat([buffer, Buffer.from(chunk)]);
        try {
          const line = buffer.toString('utf8');
          if (line.startsWith('+OK') || line.startsWith('+PONG')) {
            socket.end();
            resolve('1');
          } else if (line.startsWith('$')) {
            const lines = line.split('\r\n');
            socket.end();
            resolve(lines[1] ?? null);
          } else if (line.startsWith('$-1')) {
            socket.end();
            resolve(null);
          } else {
            socket.end();
            resolve('1');
          }
        } catch (err) {
          socket.destroy();
          reject(err);
        }
      });

      socket.on('timeout', () => socket.destroy(new Error('Timeout de Redis EventStore')));
      socket.on('error', reject);
    });
  }
}
