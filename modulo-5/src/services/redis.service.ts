import Redis from 'ioredis';
import { RideOffer } from '../types/ride-request.types';

/**
 * Servicio de Gestión de Estado Efímero y TTL con Redis (RNF-06 / RF-5.3)
 */
export class RedisService {
  private client: Redis | null = null;
  private isConnected = false;
  private memoryFallback: Map<string, { data: string; expiresAt: number }> = new Map();

  constructor(redisUrl?: string) {
    const url = redisUrl || process.env.REDIS_URL || 'redis://localhost:6379';

    // Evitar conexión en entornos de test si se especifica mock explícito
    if (process.env.DISABLE_REDIS === 'true') {
      console.log('[RedisService] Modo fallback en memoria activo (DISABLE_REDIS=true)');
      return;
    }

    try {
      this.client = new Redis(url, {
        maxRetriesPerRequest: 1,
        connectTimeout: 2000,
        retryStrategy: (times) => {
          if (times > 2) {
            return null; // Detener reintentos y usar fallback en memoria
          }
          return Math.min(times * 200, 1000);
        },
        lazyConnect: true
      });

      this.client.on('connect', () => {
        this.isConnected = true;
        console.log(`[RedisService] Conectado exitosamente a Redis (${url})`);
      });

      this.client.on('error', (err) => {
        if (this.isConnected) {
          console.warn(`[RedisService] Error de conexión con Redis: ${err.message}`);
        }
        this.isConnected = false;
      });

      // Intento de conexión no bloqueante
      this.client.connect().catch((_err) => {
        this.isConnected = false;
        // Se activa silenciosamente el fallback en memoria para desarrollo y pruebas
      });
    } catch {
      this.isConnected = false;
    }
  }

  /**
   * Guarda una oferta de viaje en Redis con TTL de expiración automática (RF-5.3)
   * Usa el comando nativo de Redis: SET key value EX ttlSeconds
   */
  public async saveOfferWithTtl(offer: RideOffer, ttlSeconds: number): Promise<void> {
    const key = `dispatch:offer:${offer.id}`;
    const payload = JSON.stringify(offer);

    if (this.isConnected && this.client) {
      try {
        // EX aplica el tiempo de vida en segundos garantizado por Redis
        await this.client.set(key, payload, 'EX', ttlSeconds);
        return;
      } catch (err) {
        console.warn(`[RedisService] Error al escribir en Redis, usando fallback: ${(err as Error).message}`);
      }
    }

    // Fallback en memoria si Redis no está disponible
    const expiresAt = Date.now() + ttlSeconds * 1000;
    this.memoryFallback.set(key, { data: payload, expiresAt });
  }

  /**
   * Recupera una oferta de viaje desde Redis.
   * Si la clave ya expiró por TTL, Redis devuelve null de forma nativa.
   */
  public async getOffer(offerId: string): Promise<RideOffer | null> {
    const key = `dispatch:offer:${offerId}`;

    if (this.isConnected && this.client) {
      try {
        const raw = await this.client.get(key);
        if (!raw) return null;
        return JSON.parse(raw) as RideOffer;
      } catch (err) {
        console.warn(`[RedisService] Error al leer de Redis, usando fallback: ${(err as Error).message}`);
      }
    }

    // Fallback en memoria
    const item = this.memoryFallback.get(key);
    if (!item) return null;

    if (Date.now() > item.expiresAt) {
      this.memoryFallback.delete(key);
      return null;
    }

    return JSON.parse(item.data) as RideOffer;
  }

  /**
   * Consulta el tiempo de vida restante (TTL) en segundos de una oferta
   */
  public async getRemainingTtl(offerId: string): Promise<number> {
    const key = `dispatch:offer:${offerId}`;

    if (this.isConnected && this.client) {
      try {
        const ttl = await this.client.ttl(key);
        return ttl; // Devuelve los segundos restantes (-2 si no existe/expiró, -1 si no tiene TTL)
      } catch {
        // Ignorar y caer en fallback
      }
    }

    const item = this.memoryFallback.get(key);
    if (!item) return -2;
    const remainingMs = item.expiresAt - Date.now();
    if (remainingMs <= 0) {
      this.memoryFallback.delete(key);
      return -2;
    }
    return Math.ceil(remainingMs / 1000);
  }

  /**
   * Elimina una oferta de Redis (utilizado cuando es aceptada o cancelada)
   */
  public async deleteOffer(offerId: string): Promise<void> {
    const key = `dispatch:offer:${offerId}`;

    if (this.isConnected && this.client) {
      try {
        await this.client.del(key);
      } catch {
        // Ignorar
      }
    }
    this.memoryFallback.delete(key);
  }

  /**
   * Informa si la conexión real a Redis está activa
   */
  public isReady(): boolean {
    return this.isConnected;
  }

  /**
   * Cierra la conexión de Redis de forma limpia
   */
  public async disconnect(): Promise<void> {
    if (this.client) {
      try {
        await this.client.quit();
      } catch {
        // Silenciar error en desconexión
      }
    }
    this.isConnected = false;
  }
}

