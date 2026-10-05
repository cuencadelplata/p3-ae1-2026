import Redis from 'ioredis';
import { M4DriverLocation, NearbyDriverStub, RideOffer, VehicleType, RideRequest, EstimatedFare } from '../types/ride-request.types';
import { RideRequestValidator } from '../schemas/ride-request.schema';

/**
 * Servicio unificado de Gestión de Estado Efímero y Caché con Redis (RNF-06, RNF-08, RNF-09)
 * Maneja:
 * 1. Idempotencia distribuida con TTL (RNF-08 - Agustín Quetglas)
 * 2. Candado atómico contra concurrencia de cliente (RNF-09 - Agustín Quetglas)
 * 3. Caché de estimación de tarifas del Módulo 7 (Agustín Quetglas)
 * 4. Ofertas con TTL automático y consulta de tiempo restante (RF-5.3 - Lautaro Romero)
 * 5. Búsqueda y filtrado geoespacial de conductores M4 en Redis (RF-5.2 - Lautaro Romero)
 * 6. Modo resiliente con fallback en memoria (no bloquea el servicio si Redis no está disponible)
 */
export class RedisService {
  private client: Redis | null = null;
  private isConnected = false;
  private connectionAttempted = false;

  // Almacenamiento en memoria para fallback resiliente y tests
  private memoryFallback: Map<string, { data: string; expiresAt?: number }> = new Map();

  constructor(redisUrl?: string) {
    const url = redisUrl || process.env.REDIS_URL;
    const host = process.env.REDIS_HOST || 'localhost';
    const port = Number(process.env.REDIS_PORT || 6379);

    if (process.env.DISABLE_REDIS === 'true') {
      console.log('[RedisService] Modo fallback en memoria activo (DISABLE_REDIS=true)');
      return;
    }

    // Si estamos en testing sin REDIS_HOST explícito ni REDIS_URL, operamos en memoria sin warnings
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
            retryStrategy: (times) => (times > 2 ? null : Math.min(times * 200, 1000))
          })
        : new Redis({
            host,
            port,
            lazyConnect: true,
            maxRetriesPerRequest: 1,
            enableOfflineQueue: false,
            connectTimeout: 2000,
            retryStrategy: (times) => (times > 2 ? null : Math.min(times * 200, 1000))
          });

      this.client.on('connect', () => {
        this.isConnected = true;
        console.log(`[RedisService] Conectado exitosamente a Redis`);
      });

      this.client.on('error', (err) => {
        if (this.isConnected) {
          console.warn(`[RedisService] Error de conexión con Redis: ${err.message}`);
        }
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

  public isReady(): boolean {
    return this.isConnected;
  }

  // ==========================================================================
  // IDEMPOTENCIA DISTRIBUIDA (RNF-08 - Agustín Quetglas)
  // ==========================================================================

  public async getIdempotentRequest(idempotencyKey: string): Promise<RideRequest | null> {
    const key = `m5:idempotency:${idempotencyKey}`;
    if (this.isConnected && this.client) {
      try {
        const data = await this.client.get(key);
        if (data) return JSON.parse(data) as RideRequest;
        return null;
      } catch {
        // Fallback
      }
    }

    const item = this.memoryFallback.get(key);
    if (!item) return null;
    if (item.expiresAt && Date.now() > item.expiresAt) {
      this.memoryFallback.delete(key);
      return null;
    }
    return JSON.parse(item.data) as RideRequest;
  }

  public async saveIdempotentRequest(
    idempotencyKey: string,
    request: RideRequest,
    ttlSeconds = 86400
  ): Promise<void> {
    const key = `m5:idempotency:${idempotencyKey}`;
    const serialized = JSON.stringify(request);

    if (this.isConnected && this.client) {
      try {
        await this.client.set(key, serialized, 'EX', ttlSeconds);
        return;
      } catch {
        // Fallback
      }
    }

    this.memoryFallback.set(key, {
      data: serialized,
      expiresAt: Date.now() + ttlSeconds * 1000
    });
  }

  // ==========================================================================
  // CANDADO ATÓMICO DE CLIENTE ACTIVO (RNF-09 - Agustín Quetglas)
  // ==========================================================================

  public async acquireClientActiveLock(
    clientId: string,
    requestId: string,
    ttlSeconds = 180
  ): Promise<boolean> {
    const key = `m5:active_client:${clientId}`;

    if (this.isConnected && this.client) {
      try {
        const result = await this.client.set(key, requestId, 'EX', ttlSeconds, 'NX');
        return result === 'OK';
      } catch {
        // Fallback
      }
    }

    const item = this.memoryFallback.get(key);
    const now = Date.now();
    if (item && (!item.expiresAt || item.expiresAt > now)) {
      return false;
    }

    this.memoryFallback.set(key, {
      data: requestId,
      expiresAt: now + ttlSeconds * 1000
    });
    return true;
  }

  public async updateClientActiveLock(
    clientId: string,
    requestId: string,
    ttlSeconds = 180
  ): Promise<void> {
    const key = `m5:active_client:${clientId}`;
    if (this.isConnected && this.client) {
      try {
        await this.client.set(key, requestId, 'EX', ttlSeconds);
        return;
      } catch {
        // Fallback
      }
    }
    this.memoryFallback.set(key, {
      data: requestId,
      expiresAt: Date.now() + ttlSeconds * 1000
    });
  }

  public async releaseClientActiveLock(clientId: string): Promise<void> {
    const key = `m5:active_client:${clientId}`;
    if (this.isConnected && this.client) {
      try {
        await this.client.del(key);
        return;
      } catch {
        // Fallback
      }
    }
    this.memoryFallback.delete(key);
  }

  public async getActiveRequestIdForClient(clientId: string): Promise<string | null> {
    const key = `m5:active_client:${clientId}`;
    if (this.isConnected && this.client) {
      try {
        return await this.client.get(key);
      } catch {
        // Fallback
      }
    }

    const item = this.memoryFallback.get(key);
    if (!item) return null;
    if (item.expiresAt && Date.now() > item.expiresAt) {
      this.memoryFallback.delete(key);
      return null;
    }
    return item.data;
  }

  // ==========================================================================
  // CACHÉ DE ESTIMACIÓN DE TARIFA CON M7 (Agustín Quetglas)
  // ==========================================================================

  public async cacheEstimatedFare(
    cacheKey: string,
    fare: EstimatedFare,
    ttlSeconds = 60
  ): Promise<void> {
    const key = `m5:fare_cache:${cacheKey}`;
    const serialized = JSON.stringify(fare);

    if (this.isConnected && this.client) {
      try {
        await this.client.set(key, serialized, 'EX', ttlSeconds);
        return;
      } catch {
        // Fallback
      }
    }

    this.memoryFallback.set(key, {
      data: serialized,
      expiresAt: Date.now() + ttlSeconds * 1000
    });
  }

  public async getCachedEstimatedFare(cacheKey: string): Promise<EstimatedFare | null> {
    const key = `m5:fare_cache:${cacheKey}`;
    if (this.isConnected && this.client) {
      try {
        const data = await this.client.get(key);
        if (data) return JSON.parse(data) as EstimatedFare;
        return null;
      } catch {
        // Fallback
      }
    }

    const item = this.memoryFallback.get(key);
    if (!item) return null;
    if (item.expiresAt && Date.now() > item.expiresAt) {
      this.memoryFallback.delete(key);
      return null;
    }
    return JSON.parse(item.data) as EstimatedFare;
  }

  // ==========================================================================
  // GESTIÓN DE OFERTAS CON TTL (RF-5.3 - Lautaro Romero)
  // ==========================================================================

  public async saveOfferWithTtl(offer: RideOffer, ttlSeconds: number): Promise<void> {
    const key = `dispatch:offer:${offer.id}`;
    const payload = JSON.stringify(offer);

    if (this.isConnected && this.client) {
      try {
        await this.client.set(key, payload, 'EX', ttlSeconds);
        return;
      } catch (err) {
        console.warn(`[RedisService] Error al escribir en Redis: ${(err as Error).message}`);
      }
    }

    const expiresAt = Date.now() + ttlSeconds * 1000;
    this.memoryFallback.set(key, { data: payload, expiresAt });
  }

  public async getOffer(offerId: string): Promise<RideOffer | null> {
    const key = `dispatch:offer:${offerId}`;

    if (this.isConnected && this.client) {
      try {
        const raw = await this.client.get(key);
        if (!raw) return null;
        return JSON.parse(raw) as RideOffer;
      } catch (err) {
        console.warn(`[RedisService] Error al leer de Redis: ${(err as Error).message}`);
      }
    }

    const item = this.memoryFallback.get(key);
    if (!item) return null;

    if (item.expiresAt && Date.now() > item.expiresAt) {
      this.memoryFallback.delete(key);
      return null;
    }

    return JSON.parse(item.data) as RideOffer;
  }

  public async getRemainingTtl(offerId: string): Promise<number> {
    const key = `dispatch:offer:${offerId}`;

    if (this.isConnected && this.client) {
      try {
        return await this.client.ttl(key);
      } catch {
        // Fallback
      }
    }

    const item = this.memoryFallback.get(key);
    if (!item) return -2;
    if (!item.expiresAt) return -1;
    const remainingMs = item.expiresAt - Date.now();
    if (remainingMs <= 0) {
      this.memoryFallback.delete(key);
      return -2;
    }
    return Math.ceil(remainingMs / 1000);
  }

  public async deleteOffer(offerId: string): Promise<void> {
    const key = `dispatch:offer:${offerId}`;
    if (this.isConnected && this.client) {
      try {
        await this.client.del(key);
      } catch {
        // Fallback
      }
    }
    this.memoryFallback.delete(key);
  }

  // ==========================================================================
  // GESTIÓN DE CONDUCTORES M4 (RF-4.2 / RF-5.2 - Lautaro Romero)
  // ==========================================================================

  public async saveM4DriverLocation(
    location: M4DriverLocation,
    ttlSeconds: number = 60
  ): Promise<void> {
    const key = `driver:${location.driverId}:location`;
    const payload = JSON.stringify(location);

    if (this.isConnected && this.client) {
      try {
        await this.client.set(key, payload, 'EX', ttlSeconds);
      } catch (err) {
        console.warn(`[RedisService] Error al escribir ubicación M4 en Redis: ${(err as Error).message}`);
      }
    }

    const expiresAt = Date.now() + ttlSeconds * 1000;
    this.memoryFallback.set(key, { data: payload, expiresAt });
  }

  public async findNearbyDriversFromM4(
    originLat: number,
    originLng: number,
    vehicleType: VehicleType,
    radiusKm: number = 5.0
  ): Promise<NearbyDriverStub[]> {
    const driversMap: Map<string, M4DriverLocation> = new Map();

    if (this.isConnected && this.client) {
      try {
        const keys = await this.client.keys('driver:*:location');
        if (keys.length > 0) {
          const values = await this.client.mget(...keys);
          for (const raw of values) {
            if (!raw) continue;
            try {
              const parsed = JSON.parse(raw) as M4DriverLocation;
              if (parsed && parsed.driverId) {
                driversMap.set(parsed.driverId, parsed);
              }
            } catch {
              // Ignorar JSON corrupto
            }
          }
        }
      } catch (err) {
        console.warn(`[RedisService] Error al buscar claves de M4 en Redis: ${(err as Error).message}`);
      }
    }

    if (driversMap.size === 0) {
      const now = Date.now();
      for (const [key, item] of this.memoryFallback.entries()) {
        if (key.startsWith('driver:') && key.endsWith(':location')) {
          if (!item.expiresAt || now <= item.expiresAt) {
            try {
              const parsed = JSON.parse(item.data) as M4DriverLocation;
              if (parsed && parsed.driverId) {
                driversMap.set(parsed.driverId, parsed);
              }
            } catch {
              // Ignorar
            }
          } else {
            this.memoryFallback.delete(key);
          }
        }
      }
    }

    if (driversMap.size === 0) {
      return [
        { driverId: 'drv_101', distanceKm: 1.2, vehicleType, rating: 4.8 },
        { driverId: 'drv_102', distanceKm: 2.1, vehicleType, rating: 4.7 }
      ];
    }

    const originGeo = { latitude: originLat, longitude: originLng, address: '' };
    const candidates: NearbyDriverStub[] = [];

    for (const driver of driversMap.values()) {
      if (driver.available !== true) continue;
      if (driver.vehicleType !== vehicleType) continue;

      const driverGeo = { latitude: driver.latitude, longitude: driver.longitude, address: '' };
      const distanceMeters = RideRequestValidator.calculateDistanceMeters(originGeo, driverGeo);
      const distanceKm = Math.round((distanceMeters / 1000) * 100) / 100;

      if (distanceKm <= radiusKm) {
        candidates.push({
          driverId: driver.driverId,
          distanceKm,
          vehicleType: driver.vehicleType,
          latitude: driver.latitude,
          longitude: driver.longitude,
          rating: 4.8
        });
      }
    }

    return candidates.sort((a, b) => a.distanceKm - b.distanceKm);
  }

  public async clearM4Drivers(): Promise<void> {
    if (this.isConnected && this.client) {
      try {
        const keys = await this.client.keys('driver:*:location');
        if (keys.length > 0) {
          await this.client.del(...keys);
        }
      } catch {
        // Ignorar
      }
    }

    for (const key of Array.from(this.memoryFallback.keys())) {
      if (key.startsWith('driver:') && key.endsWith(':location')) {
        this.memoryFallback.delete(key);
      }
    }
  }

  public clearFallback(): void {
    this.memoryFallback.clear();
  }

  public async disconnect(): Promise<void> {
    if (this.client) {
      try {
        await this.client.quit();
      } catch {
        this.client.disconnect();
      }
    }
    this.isConnected = false;
  }
}
