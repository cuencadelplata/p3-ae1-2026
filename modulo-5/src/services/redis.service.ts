import Redis from 'ioredis';
import { RideRequest, EstimatedFare, RideOffer } from '../types/ride-request.types';

export interface LockResult {
  acquired: boolean;
  holder?: string;
}

/**
 * Servicio de Gestión de Estado Efímero y Caché con Redis (RNF-06, RNF-08, RNF-09, RF-5.3, RF-5.6)
 * Maneja:
 * 1. Idempotencia distribuida con TTL (RNF-08)
 * 2. Candado atómico contra concurrencia de cliente (RNF-09) con expiración e invalidación (Criterio 6)
 * 3. Almacenamiento y expiración de ofertas de conductor con TTL (RF-5.3 / RNF-06)
 * 4. Invalidación de ofertas y lock distribuido para cancelación previa (RF-5.6)
 * 5. Caché de estimación de tarifas del Módulo 7
 * 6. Persistencia efímera de solicitudes para sobrevivir reinicios de M5 (CP-5.1-14)
 * 7. Modo resiliente con fallback en memoria cuando Redis no está disponible o en entorno de tests
 */
export class RedisService {
  private client: Redis | null = null;
  private isConnected = false;
  private connectionAttempted = false;

  // Almacenamiento en memoria para fallback resiliente
  private fallbackMemory: Map<string, { value: string; expiresAt?: number }> = new Map();
  private memoryLocks: Map<string, number> = new Map();

  constructor(redisUrl?: string) {
    const url = redisUrl || process.env.REDIS_URL;
    const host = process.env.REDIS_HOST || 'localhost';
    const port = Number(process.env.REDIS_PORT || 6379);

    if (process.env.DISABLE_REDIS === 'true') {
      console.log('[RedisService] Modo simulación activo (DISABLE_REDIS=true)');
      return;
    }

    // Si estamos en testing sin REDIS_HOST explícito, operamos en memoria sin warnings
    if (process.env.NODE_ENV === 'test' && !process.env.REDIS_HOST && !process.env.REDIS_URL) {
      this.client = null;
      return;
    }

    try {
      this.client = url
        ? new Redis(url, {
            lazyConnect: true,
            maxRetriesPerRequest: 1,
            enableOfflineQueue: false,
            connectTimeout: 2000,
            retryStrategy: () => null
          })
        : new Redis({
            host,
            port,
            lazyConnect: true,
            maxRetriesPerRequest: 1,
            enableOfflineQueue: false,
            connectTimeout: 2000,
            retryStrategy: () => null
          });

      this.client
        .connect()
        .then(() => {
          this.isConnected = true;
          console.log(`[RedisService] Conectado exitosamente a Redis (${url || `${host}:${port}`})`);
        })
        .catch(() => {
          this.isConnected = false;
        });

      this.client.on('error', (err: Error) => {
        this.isConnected = false;
        if (!this.connectionAttempted) {
          console.warn(`[RedisService] Redis no disponible. Activando modo degradado con fallback en memoria.`);
        }
      });

      this.client.on('close', () => {
        this.isConnected = false;
      });
    } catch {
      this.isConnected = false;
      this.client = null;
    }
  }

  /**
   * Intenta conectar al cliente Redis
   */
  public async init(): Promise<boolean> {
    if (this.connectionAttempted) return this.isConnected;
    this.connectionAttempted = true;

    if (!this.client) {
      return false;
    }

    try {
      await this.client.connect();
      this.isConnected = true;
      return true;
    } catch {
      this.isConnected = false;
      return false;
    }
  }

  /**
   * Informa si la conexión real a Redis está activa
   */
  public isReady(): boolean {
    return this.isConnected;
  }

  /**
   * Verifica la salud de la conexión a Redis (RNF-16)
   */
  public async isHealthy(): Promise<boolean> {
    if (!this.client || !this.isConnected) {
      return false;
    }
    try {
      const pong = await this.client.ping();
      return pong === 'PONG';
    } catch {
      this.isConnected = false;
      return false;
    }
  }

  // ==========================================================================
  // OFERTAS DE CONDUCTOR (RF-5.3 / RNF-06 / RF-5.6)
  // ==========================================================================

  /**
   * Guarda una oferta en Redis aplicando un TTL exacto (RF-5.3 / RNF-06)
   */
  public async saveOffer(offer: RideOffer, ttlSeconds: number): Promise<void> {
    const key = `dispatch:offer:${offer.id}`;
    const payload = JSON.stringify(offer);

    if (this.isConnected && this.client) {
      try {
        await this.client.set(key, payload, 'EX', ttlSeconds);
        return;
      } catch (err) {
        console.warn(`[RedisService] Error al escribir oferta en Redis: ${(err as Error).message}`);
      }
    }

    this.fallbackMemory.set(key, {
      value: payload,
      expiresAt: Date.now() + ttlSeconds * 1000
    });
  }

  /**
   * Obtiene una oferta desde Redis (verifica automáticamente expiración)
   */
  public async getOffer(offerId: string): Promise<RideOffer | null> {
    const key = `dispatch:offer:${offerId}`;

    if (this.isConnected && this.client) {
      try {
        const raw = await this.client.get(key);
        if (raw) {
          return JSON.parse(raw) as RideOffer;
        }
        return null;
      } catch (err) {
        console.warn(`[RedisService] Error al leer oferta de Redis: ${(err as Error).message}`);
      }
    }

    const item = this.fallbackMemory.get(key);
    if (!item) return null;
    if (item.expiresAt && Date.now() > item.expiresAt) {
      this.fallbackMemory.delete(key);
      return null;
    }
    return JSON.parse(item.value) as RideOffer;
  }

  /**
   * Consulta el tiempo restante de vida (TTL) de una oferta en segundos
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

    const item = this.fallbackMemory.get(key);
    if (!item) return -2;
    if (!item.expiresAt) return -1;
    const remainingMs = item.expiresAt - Date.now();
    if (remainingMs <= 0) {
      this.fallbackMemory.delete(key);
      return -2;
    }
    return Math.ceil(remainingMs / 1000);
  }

  /**
   * Invalida (elimina) una oferta en Redis inmediatamente (RNF-06 / RF-5.6)
   */
  public async invalidateOffer(offerId: string): Promise<void> {
    const key = `dispatch:offer:${offerId}`;

    if (this.isConnected && this.client) {
      try {
        await this.client.del(key);
        return;
      } catch (err) {
        console.warn(`[RedisService] Error al invalidar oferta en Redis: ${(err as Error).message}`);
      }
    }

    this.fallbackMemory.delete(key);
  }

  /**
   * Invalida de forma atómica todas las ofertas vinculadas a una solicitud cancelada (RF-5.6)
   */
  public async invalidateOffersForRequest(offerIds: string[]): Promise<void> {
    if (!offerIds || offerIds.length === 0) return;

    const keys = offerIds.map((id) => `dispatch:offer:${id}`);

    if (this.isConnected && this.client) {
      try {
        await this.client.del(...keys);
      } catch (err) {
        console.warn(`[RedisService] Error invalidando ofertas en Redis: ${(err as Error).message}`);
      }
    }

    for (const key of keys) {
      this.fallbackMemory.delete(key);
    }
  }

  public async deleteOffer(offerId: string): Promise<void> {
    return this.invalidateOffer(offerId);
  }

  /**
   * Marca una solicitud de viaje como cancelada en Redis con TTL (RF-5.6)
   */
  public async markRequestCancelled(requestId: string, ttlSeconds = 3600): Promise<void> {
    const key = `dispatch:request:${requestId}:cancelled`;
    const payload = JSON.stringify({ cancelledAt: new Date().toISOString() });

    if (this.isConnected && this.client) {
      try {
        await this.client.set(key, payload, 'EX', ttlSeconds);
        return;
      } catch {
        // Fallback
      }
    }

    this.fallbackMemory.set(key, {
      value: payload,
      expiresAt: Date.now() + ttlSeconds * 1000
    });
  }

  /**
   * Verifica si una solicitud fue marcada como cancelada en Redis
   */
  public async isRequestCancelled(requestId: string): Promise<boolean> {
    const key = `dispatch:request:${requestId}:cancelled`;

    if (this.isConnected && this.client) {
      try {
        const raw = await this.client.get(key);
        return raw !== null;
      } catch {
        // Fallback
      }
    }

    const item = this.fallbackMemory.get(key);
    if (!item) return false;
    if (item.expiresAt && Date.now() > item.expiresAt) {
      this.fallbackMemory.delete(key);
      return false;
    }
    return true;
  }

  /**
   * Adquiere un lock distribuido para evitar condiciones de carrera (RNF-09)
   */
  public async acquireLock(lockKey: string, ttlMs = 3000): Promise<boolean> {
    const key = `dispatch:lock:${lockKey}`;

    if (this.isConnected && this.client) {
      try {
        const result = await this.client.set(key, 'LOCKED', 'PX', ttlMs, 'NX');
        return result === 'OK';
      } catch {
        // Fallback
      }
    }

    const now = Date.now();
    const existingExpire = this.memoryLocks.get(key);
    if (existingExpire && existingExpire > now) {
      return false;
    }
    const existingFallback = this.fallbackMemory.get(key);
    if (existingFallback && (!existingFallback.expiresAt || existingFallback.expiresAt > now)) {
      return false;
    }

    this.memoryLocks.set(key, now + ttlMs);
    return true;
  }

  /**
   * Libera un lock distribuido
   */
  public async releaseLock(lockKey: string): Promise<void> {
    const key = `dispatch:lock:${lockKey}`;

    if (this.isConnected && this.client) {
      try {
        await this.client.del(key);
      } catch {
        // Ignorar
      }
    }

    this.memoryLocks.delete(key);
    this.fallbackMemory.delete(key);
  }

  /**
   * Distributed Lock atómico para asignación de viajes (RF-5.5)
   * Utiliza SET key value NX EX ttl para garantizar exclusión mutua
   * en escenarios de múltiples conductores respondiendo en paralelo.
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
        const result = await this.client.set(lockKey, lockValue, 'EX', ttlSeconds, 'NX');
        if (result === 'OK') {
          return { acquired: true, holder: driverId };
        }
        const existingData = await this.client.get(lockKey);
        const holder = existingData ? (JSON.parse(existingData).driverId as string) : undefined;
        return { acquired: false, holder };
      } catch (err) {
        throw err;
      }
    }

    const now = Date.now();
    const existingLock = this.memoryLocks.get(lockKey);
    if (existingLock && existingLock > now) {
      return { acquired: false };
    }
    const existing = this.fallbackMemory.get(lockKey);
    if (existing && (!existing.expiresAt || existing.expiresAt > now)) {
      try {
        const parsed = JSON.parse(existing.value);
        return { acquired: false, holder: parsed.driverId };
      } catch {
        return { acquired: false };
      }
    }

    this.memoryLocks.set(lockKey, now + ttlSeconds * 1000);
    this.fallbackMemory.set(lockKey, {
      value: lockValue,
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

    this.memoryLocks.delete(lockKey);
    this.fallbackMemory.delete(lockKey);
  }

  // ==========================================================================
  // IDEMPOTENCIA DISTRIBUIDA (RNF-08 - Criterio 7)
  // ==========================================================================

  /**
   * Obtiene una solicitud guardada por Idempotency-Key
   */
  public async getIdempotentRequest(idempotencyKey: string): Promise<RideRequest | null> {
    const key = `m5:idempotency:${idempotencyKey}`;
    try {
      if (this.isConnected && this.client) {
        const data = await this.client.get(key);
        if (data) {
          return JSON.parse(data) as RideRequest;
        }
        return null;
      }
    } catch {
      // Fallback a memoria
    }

    const item = this.fallbackMemory.get(key);
    if (!item) return null;
    if (item.expiresAt && Date.now() > item.expiresAt) {
      this.fallbackMemory.delete(key);
      return null;
    }
    return JSON.parse(item.value) as RideRequest;
  }

  /**
   * Guarda una solicitud con Idempotency-Key y TTL (por defecto 24 horas)
   */
  public async saveIdempotentRequest(
    idempotencyKey: string,
    request: RideRequest,
    ttlSeconds = 86400
  ): Promise<void> {
    const key = `m5:idempotency:${idempotencyKey}`;
    const serialized = JSON.stringify(request);

    try {
      if (this.isConnected && this.client) {
        await this.client.set(key, serialized, 'EX', ttlSeconds);
        return;
      }
    } catch {
      // Fallback a memoria
    }

    this.fallbackMemory.set(key, {
      value: serialized,
      expiresAt: Date.now() + ttlSeconds * 1000
    });
  }

  // ==========================================================================
  // PERSISTENCIA EFÍMERA / RECUPERACIÓN DE SOLICITUDES (CP-5.1-14)
  // Guarda y recupera solicitudes por ID para sobrevivir reinicios de M5
  // ==========================================================================

  /**
   * Guarda una solicitud por ID en Redis para permitir su recuperación tras reiniciar el servicio
   */
  public async saveRideRequest(request: RideRequest, ttlSeconds = 86400): Promise<void> {
    const key = `m5:request:${request.id}`;
    const serialized = JSON.stringify(request);

    try {
      if (this.isConnected && this.client) {
        await this.client.set(key, serialized, 'EX', ttlSeconds);
        return;
      }
    } catch {
      // Fallback
    }

    this.fallbackMemory.set(key, {
      value: serialized,
      expiresAt: Date.now() + ttlSeconds * 1000
    });
  }

  /**
   * Obtiene una solicitud guardada por su ID desde Redis
   */
  public async getRideRequest(requestId: string): Promise<RideRequest | null> {
    const key = `m5:request:${requestId}`;
    try {
      if (this.isConnected && this.client) {
        const data = await this.client.get(key);
        if (data) {
          return JSON.parse(data) as RideRequest;
        }
        return null;
      }
    } catch {
      // Fallback
    }

    const item = this.fallbackMemory.get(key);
    if (!item) return null;
    if (item.expiresAt && Date.now() > item.expiresAt) {
      this.fallbackMemory.delete(key);
      return null;
    }
    return JSON.parse(item.value) as RideRequest;
  }

  // ==========================================================================
  // CANDADO ATÓMICO DE CLIENTE ACTIVO (RNF-09 - Criterios 6 y 7)
  // Operación SET ... NX EX para evitar solicitudes concurrentes simultáneas
  // ==========================================================================

  /**
   * Intenta adquirir un bloqueo atómico de solicitud activa para un cliente.
   * Retorna true si adquirió el candado (el cliente estaba libre), o false si ya existía.
   */
  public async acquireClientActiveLock(
    clientId: string,
    requestId: string,
    ttlSeconds = 180
  ): Promise<boolean> {
    const key = `m5:active_client:${clientId}`;

    try {
      if (this.isConnected && this.client) {
        const result = await this.client.set(key, requestId, 'EX', ttlSeconds, 'NX');
        return result === 'OK';
      }
    } catch {
      // Fallback a memoria
    }

    const item = this.fallbackMemory.get(key);
    const now = Date.now();
    if (item && (!item.expiresAt || item.expiresAt > now)) {
      return false;
    }

    this.fallbackMemory.set(key, {
      value: requestId,
      expiresAt: now + ttlSeconds * 1000
    });
    return true;
  }

  /**
   * Actualiza el ID de la solicitud en el candado existente
   */
  public async updateClientActiveLock(
    clientId: string,
    requestId: string,
    ttlSeconds = 180
  ): Promise<void> {
    const key = `m5:active_client:${clientId}`;
    try {
      if (this.isConnected && this.client) {
        await this.client.set(key, requestId, 'EX', ttlSeconds);
        return;
      }
    } catch {
      // Fallback
    }
    this.fallbackMemory.set(key, {
      value: requestId,
      expiresAt: Date.now() + ttlSeconds * 1000
    });
  }

  /** Reserva la nueva solicitud solamente si el candado sigue siendo del viaje comprobado. */
  public async replaceCompletedClientLock(clientId: string, completedRequestId: string, ttlSeconds: number): Promise<boolean> {
    const key = `m5:active_client:${clientId}`;
    if (this.isConnected && this.client) {
      try {
        const result = await this.client.eval(
          "local value = redis.call('GET', KEYS[1]); if value and value ~= ARGV[1] then return 0 end; redis.call('SET', KEYS[1], 'PENDING_INIT', 'EX', ARGV[2]); return 1",
          1, key, completedRequestId, ttlSeconds,
        );
        return result === 1;
      } catch {
        return false;
      }
    }

    const item = this.fallbackMemory.get(key);
    const now = Date.now();
    if (item && (!item.expiresAt || item.expiresAt > now) && item.value !== completedRequestId) return false;
    this.fallbackMemory.set(key, { value: 'PENDING_INIT', expiresAt: now + ttlSeconds * 1000 });
    return true;
  }

  /**
   * Invalida y libera explícitamente el candado de solicitud activa del cliente
   */
  public async releaseClientActiveLock(clientId: string): Promise<void> {
    const key = `m5:active_client:${clientId}`;
    try {
      if (this.isConnected && this.client) {
        await this.client.del(key);
        return;
      }
    } catch {
      // Fallback
    }
    this.fallbackMemory.delete(key);
  }

  /**
   * Consulta el ID de la solicitud activa de un cliente
   */
  public async getActiveRequestIdForClient(clientId: string): Promise<string | null> {
    const key = `m5:active_client:${clientId}`;
    try {
      if (this.isConnected && this.client) {
        return await this.client.get(key);
      }
    } catch {
      // Fallback
    }

    const item = this.fallbackMemory.get(key);
    if (!item) return null;
    if (item.expiresAt && Date.now() > item.expiresAt) {
      this.fallbackMemory.delete(key);
      return null;
    }
    return item.value;
  }

  // ==========================================================================
  // CACHÉ DE ESTIMACIÓN DE TARIFA CON M7 (RNF-06 - Criterio 6)
  // ==========================================================================

  public async cacheEstimatedFare(
    cacheKey: string,
    fare: EstimatedFare,
    ttlSeconds = 60
  ): Promise<void> {
    const key = `m5:fare_cache:${cacheKey}`;
    const serialized = JSON.stringify(fare);

    try {
      if (this.isConnected && this.client) {
        await this.client.set(key, serialized, 'EX', ttlSeconds);
        return;
      }
    } catch {
      // Fallback
    }

    this.fallbackMemory.set(key, {
      value: serialized,
      expiresAt: Date.now() + ttlSeconds * 1000
    });
  }

  public async getCachedEstimatedFare(cacheKey: string): Promise<EstimatedFare | null> {
    const key = `m5:fare_cache:${cacheKey}`;
    try {
      if (this.isConnected && this.client) {
        const data = await this.client.get(key);
        if (data) {
          return JSON.parse(data) as EstimatedFare;
        }
        return null;
      }
    } catch {
      // Fallback
    }

    const item = this.fallbackMemory.get(key);
    if (!item) return null;
    if (item.expiresAt && Date.now() > item.expiresAt) {
      this.fallbackMemory.delete(key);
      return null;
    }
    return JSON.parse(item.value) as EstimatedFare;
  }

  /**
   * Limpia toda la memoria fallback (útil para tests unitarios)
   */
  public clearFallback(): void {
    this.fallbackMemory.clear();
    this.memoryLocks.clear();
  }

  /**
   * Desconecta el cliente de Redis al apagar el servicio
   */
  public async disconnect(): Promise<void> {
    if (this.client && this.isConnected) {
      try {
        await this.client.quit();
      } catch {
        this.client.disconnect();
      }
      this.isConnected = false;
    }
  }
}
