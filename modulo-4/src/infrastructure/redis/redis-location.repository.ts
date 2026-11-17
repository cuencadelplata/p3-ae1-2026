import net from 'node:net';
import type { DriverLocation } from '../../domain/entities/location.entity.js';
import type { LocationRepository, SaveLocationResult } from '../../ports/location-repository.port.js';
import { Logger } from '../logger/structured.logger.js';

type RedisValue = string | number | null | RedisValue[];

interface ParsedValue {
  value: RedisValue;
  offset: number;
}

export class RedisLocationRepository implements LocationRepository {
  private readonly host: string;
  private readonly port: number;
  private readonly password?: string;
  private readonly database: number;
  private readonly keyPrefix: string;

  public constructor(redisUrl: string, keyPrefix = 'driver:') {
    const url = new URL(redisUrl);
    if (url.protocol !== 'redis:') throw new Error('REDIS_URL debe comenzar con redis://');
    this.host = url.hostname || '127.0.0.1';
    this.port = Number(url.port || 6379);
    this.password = url.password ? decodeURIComponent(url.password) : undefined;
    this.database = url.pathname.length > 1 ? Number(url.pathname.slice(1)) : 0;
    this.keyPrefix = keyPrefix;
  }

  public async ping(): Promise<void> {
    const response = await this.command(['PING']);
    if (response !== 'PONG') throw new Error('Redis no respondió PONG');
  }

  public async saveIfNewer(
    location: DriverLocation,
    ttlSeconds: number
  ): Promise<SaveLocationResult> {
    const script = [
      "local current = redis.call('GET', KEYS[1])",
      'if current then',
      '  local decoded = cjson.decode(current)',
      '  if ARGV[2] < decoded.updatedAt then return 0 end',
      'end',
      "redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[3])",
      'return 1'
    ].join('\n');

    const response = await this.command([
      'EVAL',
      script,
      '1',
      this.key(location.driverId),
      JSON.stringify(location),
      location.updatedAt,
      String(ttlSeconds)
    ]);

    if (response === 1) {
      Logger.info(`Ubicación guardada en Redis para conductor ${location.driverId}`, { driverId: location.driverId });
      return { saved: true, location };
    }

    const current = await this.get(location.driverId);
    return { saved: false, location: current ?? location };
  }

  public async get(driverId: number): Promise<DriverLocation | null> {
    const value = await this.command(['GET', this.key(driverId)]);
    return typeof value === 'string' ? (JSON.parse(value) as DriverLocation) : null;
  }

  public async getAll(): Promise<DriverLocation[]> {
    const keys = await this.command(['KEYS', `${this.keyPrefix}*:location`]);
    if (!Array.isArray(keys)) return [];

    const locations = await Promise.all(
      keys.filter((key): key is string => typeof key === 'string').map(async (key) => {
        const value = await this.command(['GET', key]);
        return typeof value === 'string' ? (JSON.parse(value) as DriverLocation) : null;
      })
    );

    return locations.filter((location): location is DriverLocation => location !== null);
  }

  public async delete(driverId: number): Promise<boolean> {
    const result = await this.command(['DEL', this.key(driverId)]);
    return result === 1;
  }

  public async clear(): Promise<void> {
    const keys = await this.command(['KEYS', `${this.keyPrefix}*:location`]);
    if (Array.isArray(keys) && keys.length > 0) {
      await this.command(['DEL', ...keys.map(String)]);
    }
  }

  /**
   * Formato de clave Redis (Requerimiento 3): driver:{driverId}:location
   */
  private key(driverId: number): string {
    return `${this.keyPrefix}${driverId}:location`;
  }

  private async command(command: string[]): Promise<RedisValue> {
    const commands: string[][] = [];
    if (this.password) commands.push(['AUTH', this.password]);
    if (this.database > 0) commands.push(['SELECT', String(this.database)]);
    commands.push(command);

    return new Promise((resolve, reject) => {
      const socket = net.createConnection({ host: this.host, port: this.port });
      let buffer = Buffer.alloc(0);

      socket.setTimeout(5_000);
      socket.on('connect', () => socket.write(commands.map(this.encode).join('')));
      socket.on('data', (chunk) => {
        buffer = Buffer.concat([buffer, Buffer.from(chunk)]);
        try {
          let offset = 0;
          const responses: RedisValue[] = [];
          while (responses.length < commands.length) {
            const parsed = this.parse(buffer, offset);
            if (!parsed) return;
            responses.push(parsed.value);
            offset = parsed.offset;
          }
          socket.end();
          resolve(responses.at(-1) ?? null);
        } catch (error) {
          socket.destroy();
          reject(error);
        }
      });
      socket.on('timeout', () => socket.destroy(new Error('Timeout al conectar con Redis')));
      socket.on('error', reject);
    });
  }

  private encode = (parts: string[]): string =>
    `*${parts.length}\r\n${parts
      .map((part) => `$${Buffer.byteLength(part)}\r\n${part}\r\n`)
      .join('')}`;

  private parse(buffer: Buffer, offset: number): ParsedValue | null {
    if (offset >= buffer.length) return null;
    const type = String.fromCharCode(buffer[offset]);
    const lineEnd = buffer.indexOf('\r\n', offset + 1);
    if (lineEnd === -1) return null;
    const line = buffer.toString('utf8', offset + 1, lineEnd);
    const next = lineEnd + 2;

    if (type === '+' || type === ':') {
      return { value: type === ':' ? Number(line) : line, offset: next };
    }
    if (type === '-') throw new Error(`Redis: ${line}`);
    if (type === '$') {
      const length = Number(line);
      if (length === -1) return { value: null, offset: next };
      if (buffer.length < next + length + 2) return null;
      return {
        value: buffer.toString('utf8', next, next + length),
        offset: next + length + 2
      };
    }
    if (type === '*') {
      const length = Number(line);
      const values: RedisValue[] = [];
      let current = next;
      for (let index = 0; index < length; index += 1) {
        const parsed = this.parse(buffer, current);
        if (!parsed) return null;
        values.push(parsed.value);
        current = parsed.offset;
      }
      return { value: values, offset: current };
    }
    throw new Error('Respuesta desconocida de Redis');
  }
}
