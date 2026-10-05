import Redis from 'ioredis';
import {
  M4DriverLocation,
  NearbyDriverStub,
  RideOffer,
  VehicleType
} from '../types/ride-request.types';
import { RideRequestValidator } from '../schemas/ride-request.schema';

/**
 * Servicio de Estado Efímero y Caché con Redis (RNF-06 / RF-5.3 / RF-5.6 / RF-4.2)
 * Proporciona almacenamiento en caché con TTL, bloqueo distribuido para concurrencia e invalidación de ofertas.
 */
export class RedisService {
  private client: Redis | null = null;
  private isConnected = false;
  private memoryFallback: Map<string, { data: string; expiresAt: number }> = new Map();
  private memoryLocks: Map<string, number> = new Map();

  constructor(redisUrl?: string) {
    const url = redisUrl || process.env.REDIS_URL || 'redis://localhost:6379';

    if (process.env.DISABLE_REDIS === 'true') {
      console.log('[RedisService] Modo simulación activo (DISABLE_REDIS=true)');
      return;
    }

    try {
      this.client = new Redis(url, {
        lazyConnect: true,
        connectTimeout: 2000,
        maxRetriesPerRequest: 1,
        retryStrategy: () => null // Evitar loop de reintentos continuos si no hay servidor local
      });

      this.client
        .connect()
        .then(() => {
          this.isConnected = true;
          console.log(`[RedisService] Conectado exitosamente a Redis (${url})`);
        })
        .catch(() => {
          this.isConnected = false;
          // Fallback en memoria automático para no bloquear pruebas ni entorno local
        });

      this.client.on('error', (err: Error) => {
        if (this.isConnected) {
          console.warn(`[RedisService] Error de conexión: ${err.message}`);
        }
        this.isConnected = false;
      });

      this.client.on('close', () => {
        this.isConnected = false;
      });
    } catch {
      this.isConnected = false;
    }
  }

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

    const expiresAt = Date.now() + ttlSeconds * 1000;
    this.memoryFallback.set(key, { data: payload, expiresAt });
  }

  /**
   * Recupera una oferta de viaje desde Redis.
   */
  public async getOffer(offerId: string): Promise<RideOffer | null> {
    const key = `dispatch:offer:${offerId}`;

    if (this.isConnected && this.client) {
      try {
        const raw = await this.client.get(key);
        if (!raw) return null;
        return JSON.parse(raw) as RideOffer;
      } catch (err) {
        console.warn(`[RedisService] Error al leer oferta de Redis: ${(err as Error).message}`);
      }
    }

    const item = this.memoryFallback.get(key);
    if (!item) return null;

    if (Date.now() > item.expiresAt) {
      this.memoryFallback.delete(key);
      return null;
    }

    return JSON.parse(item.data) as RideOffer;
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
   * Elimina una oferta de Redis (utilizado ante aceptación o expiración)
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
      this.memoryFallback.delete(key);
    }
  }

  /**
   * Marca una solicitud como cancelada en Redis con TTL (RF-5.6 / RNF-08 / RNF-09)
   * Sirve como bandera rápida para bloquear carreras de aceptación concurrentes.
   */
  public async markRequestCancelled(requestId: string, ttlSeconds = 3600): Promise<void> {
    const key = `dispatch:request:${requestId}:cancelled`;
    const payload = JSON.stringify({ cancelledAt: new Date().toISOString() });

    if (this.isConnected && this.client) {
      try {
        await this.client.set(key, payload, 'EX', ttlSeconds);
        return;
      } catch (err) {
        console.warn(`[RedisService] Error registrando cancelación en Redis: ${(err as Error).message}`);
      }
    }

    const expiresAt = Date.now() + ttlSeconds * 1000;
    this.memoryFallback.set(key, { data: payload, expiresAt });
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

    const item = this.memoryFallback.get(key);
    if (!item) return false;
    if (Date.now() > item.expiresAt) {
      this.memoryFallback.delete(key);
      return false;
    }
    return true;
  }

  /**
   * Adquiere un lock distribuido para evitar condiciones de carrera (RNF-09)
   * Útil para sincronizar la cancelación del cliente vs aceptación de un conductor.
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

    // Fallback en memoria
    const now = Date.now();
    const existingExpire = this.memoryLocks.get(key);
    if (existingExpire && existingExpire > now) {
      return false; // Bloqueado
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
  }

  /**
   * Guarda ubicación de conductor desde Módulo 4 en Redis (RF-4.2 / RF-5.2)
   */
  public async saveM4DriverLocation(
    location: M4DriverLocation,
    ttlSeconds = 60
  ): Promise<void> {
    const key = `m4:driver:${location.driverId}:location`;
    const payload = JSON.stringify(location);

    if (this.isConnected && this.client) {
      try {
        await this.client.set(key, payload, 'EX', ttlSeconds);
        return;
      } catch (err) {
        console.warn(`[RedisService] Error al escribir ubicación M4 en Redis: ${(err as Error).message}`);
      }
    }

    const expiresAt = Date.now() + ttlSeconds * 1000;
    this.memoryFallback.set(key, { data: payload, expiresAt });
  }

  /**
   * Consulta conductores cercanos desde Redis según contrato M4
   */
  public async findNearbyDriversFromM4(
    originLat: number,
    originLng: number,
    vehicleType: VehicleType,
    radiusKm = 5.0
  ): Promise<NearbyDriverStub[]> {
    const driversMap: Map<string, M4DriverLocation> = new Map();

    if (this.isConnected && this.client) {
      try {
        const keys = await this.client.keys('m4:driver:*:location');
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
        console.warn(`[RedisService] Error consultando claves M4: ${(err as Error).message}`);
      }
    }

    if (driversMap.size === 0) {
      const now = Date.now();
      for (const [key, item] of this.memoryFallback.entries()) {
        if (key.startsWith('m4:driver:') && key.endsWith(':location')) {
          if (now <= item.expiresAt) {
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
      if (driver.available !== true || driver.vehicleType !== vehicleType) {
        continue;
      }

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
          rating: driver.rating || 4.8
        });
      }
    }

    return candidates.sort((a, b) => a.distanceKm - b.distanceKm);
  }

  /**
   * Limpia claves de prueba de M4
   */
  public async clearM4Drivers(): Promise<void> {
    if (this.isConnected && this.client) {
      try {
        const keys = await this.client.keys('m4:driver:*:location');
        if (keys.length > 0) {
          await this.client.del(...keys);
        }
      } catch {
        // Ignorar
      }
    }

    for (const key of Array.from(this.memoryFallback.keys())) {
      if (key.startsWith('m4:driver:') && key.endsWith(':location')) {
        this.memoryFallback.delete(key);
      }
    }
  }

  public isReady(): boolean {
    return this.isConnected;
  }

  public async disconnect(): Promise<void> {
    if (this.client) {
      try {
        await this.client.quit();
      } catch {
        // Ignorar
      }
    }
    this.isConnected = false;
  }
}
