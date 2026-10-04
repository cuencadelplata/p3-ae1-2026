import Redis from 'ioredis';
import { RideOffer } from '../types/ride-request.types';

export interface LockResult {
  acquired: boolean;
  holder?: string;
}

/**
 * Servicio de integración con Redis para Módulo 5
 * Maneja:
 * - Caché y TTL de ofertas de viaje (RF-5.3, RF-5.4)
 * - Distributed Locking atómico para asignación única y prevención de carreras de concurrencia (RF-5.5)
 * - Fallback transparente en memoria para desarrollo y pruebas aisladas
 */
export class RedisService {
  private client: Redis | null = null;
  private isConnected = false;

  // Almacén de fallback en memoria si Redis no está disponible
  private memoryOffers = new Map<string, { offer: RideOffer; expiresAt: number }>();
  private memoryLocks = new Map<string, { driverId: string; expiresAt: number }>();

  constructor(private readonly redisUrl?: string) {
    const url = this.redisUrl || process.env.REDIS_URL || 'redis://localhost:6379';
    this.initClient(url);
  }

  private initClient(url: string): void {
    try {
      this.client = new Redis(url, {
        maxRetriesPerRequest: 1,
        retryStrategy: (times) => {
          if (times > 3) {
            // Desactiva reintentos infinitos para pasar a modo fallback silencioso
            return null;
          }
          return Math.min(times * 100, 1000);
        },
        lazyConnect: true,
        connectTimeout: 2000
      });

      this.client.on('connect', () => {
        this.isConnected = true;
        console.log('[RedisService] Conectado exitosamente a Redis.');
      });

      this.client.on('error', (err) => {
        this.isConnected = false;
        // Solo loguea en depuración para no saturar consola en fallback
        if (process.env.NODE_ENV !== 'test') {
          console.warn(`[RedisService] Redis no disponible (${err.message}). Utilizando fallback en memoria.`);
        }
      });

      // Intento de conexión no bloqueante
      this.client.connect().catch(() => {
        this.isConnected = false;
      });
    } catch {
      this.isConnected = false;
    }
  }

  /**
   * Guarda una oferta con TTL en Redis (RF-5.3)
   * Clave: dispatch:offer:{offerId}
   */
  public async saveOffer(offer: RideOffer, ttlSeconds: number): Promise<void> {
    const key = `dispatch:offer:${offer.id}`;
    const payload = JSON.stringify(offer);

    if (this.isConnected && this.client) {
      try {
        await this.client.set(key, payload, 'EX', ttlSeconds);
        return;
      } catch {
        // Fallback si falla la llamada
      }
    }

    // Fallback en memoria
    this.memoryOffers.set(offer.id, {
      offer,
      expiresAt: Date.now() + ttlSeconds * 1000
    });
  }

  /**
   * Obtiene una oferta desde Redis (RF-5.4)
   * Si la oferta expiró o no existe, retorna null.
   */
  public async getOffer(offerId: string): Promise<RideOffer | null> {
    const key = `dispatch:offer:${offerId}`;

    if (this.isConnected && this.client) {
      try {
        const data = await this.client.get(key);
        if (!data) return null;
        return JSON.parse(data) as RideOffer;
      } catch {
        // Fallback
      }
    }

    // Fallback en memoria
    const memoryEntry = this.memoryOffers.get(offerId);
    if (!memoryEntry) return null;

    if (Date.now() > memoryEntry.expiresAt) {
      this.memoryOffers.delete(offerId);
      return null;
    }

    return memoryEntry.offer;
  }

  /**
   * Obtiene el tiempo restante de vida (TTL) en segundos de una oferta (RF-5.4)
   * Retorna -2 si no existe o ya expiró.
   */
  public async getRemainingTtl(offerId: string): Promise<number> {
    const key = `dispatch:offer:${offerId}`;

    if (this.isConnected && this.client) {
      try {
        return await this.client.ttl(key);
      } catch {
        // Fallback
      }
    }

    const memoryEntry = this.memoryOffers.get(offerId);
    if (!memoryEntry) return -2;

    const remainingMs = memoryEntry.expiresAt - Date.now();
    if (remainingMs <= 0) {
      this.memoryOffers.delete(offerId);
      return -2;
    }

    return Math.ceil(remainingMs / 1000);
  }

  /**
   * Elimina una oferta de Redis (RF-5.5 / RF-5.6)
   */
  public async deleteOffer(offerId: string): Promise<void> {
    const key = `dispatch:offer:${offerId}`;

    if (this.isConnected && this.client) {
      try {
        await this.client.del(key);
        return;
      } catch {
        // Fallback
      }
    }

    this.memoryOffers.delete(offerId);
  }

  /**
   * Intenta adquirir un bloqueo distribuido atómico para asignar un viaje (RF-5.5 / RNF-09)
   * Utiliza la instrucción atómica SET NX (Not Exists) con TTL.
   * Clave: dispatch:lock:request:{requestId}
   * 
   * @param requestId Identificador de la solicitud de viaje
   * @param driverId Identificador del conductor que intenta adjudicarse el viaje
   * @param ttlSeconds Tiempo de vida del lock (default: 30 segundos)
   * @returns LockResult { acquired: boolean, holder?: string }
   */
  public async acquireAssignmentLock(
    requestId: string,
    driverId: string,
    ttlSeconds = 30
  ): Promise<LockResult> {
    const lockKey = `dispatch:lock:request:${requestId}`;
    const lockValue = JSON.stringify({
      driverId,
      acquiredAt: new Date().toISOString()
    });

    if (this.isConnected && this.client) {
      try {
        // SET key value NX EX ttl (Atómico en Redis)
        const result = await this.client.set(lockKey, lockValue, 'EX', ttlSeconds, 'NX');
        if (result === 'OK') {
          return { acquired: true, holder: driverId };
        }

        // Si falló adquirirlo, obtenemos quién es el titular del lock
        const existingData = await this.client.get(lockKey);
        const holder = existingData ? (JSON.parse(existingData).driverId as string) : undefined;
        return { acquired: false, holder };
      } catch {
        // Fallback
      }
    }

    // Fallback atómico en memoria
    const now = Date.now();
    const existingLock = this.memoryLocks.get(requestId);

    if (existingLock && existingLock.expiresAt > now) {
      return { acquired: false, holder: existingLock.driverId };
    }

    this.memoryLocks.set(requestId, {
      driverId,
      expiresAt: now + ttlSeconds * 1000
    });

    return { acquired: true, holder: driverId };
  }

  /**
   * Libera el bloqueo de asignación si fuera necesario
   */
  public async releaseAssignmentLock(requestId: string): Promise<void> {
    const lockKey = `dispatch:lock:request:${requestId}`;

    if (this.isConnected && this.client) {
      try {
        await this.client.del(lockKey);
        return;
      } catch {
        // Fallback
      }
    }

    this.memoryLocks.delete(requestId);
  }

  /**
   * Cierra limpiamente la conexión a Redis
   */
  public async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.quit().catch(() => {});
      this.isConnected = false;
    }
  }
}
