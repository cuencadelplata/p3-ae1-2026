import Redis from 'ioredis';
import { M4DriverLocation, NearbyDriverStub, RideOffer, VehicleType, RideRequest, EstimatedFare } from '../types/ride-request.types';
import { RideRequestValidator } from '../schemas/ride-request.schema';

export interface LockResult {
  acquired: boolean;
  holder?: string;
}

/**
 * Servicio unificado de Gestión de Estado Efímero y Caché con Redis (RNF-06, RNF-08, RNF-09)
 * Maneja:
 * 1. Ofertas efímeras con TTL automático y consulta de tiempo restante (RF-5.3, RF-5.4)
 * 2. Distributed Locking atómico para asignación única (RF-5.5 / RNF-09)
 * 3. Candado atómico de cliente activo (RNF-09)
 * 4. Idempotencia distribuida con TTL (RNF-08)
 * 5. Caché de estimación de tarifas del Módulo 7 (RNF-06)
 * 6. Búsqueda y filtrado geoespacial de conductores M4 en Redis (RF-5.2)
 * 7. Modo resiliente con fallback en memoria (no bloquea el servicio si Redis no está disponible)
 */
export class RedisService {
  private client: Redis | null = null;
  private isConnected = false;
  private connectionAttempted = false;

  // Almacén en memoria para fallback resiliente y tests
  private memoryOffers = new Map<string, { offer: RideOffer; expiresAt: number }>();
  private memoryLocks = new Map<string, { driverId: string; expiresAt: number }>();
  private memoryFallback = new Map<string, { data: string; expiresAt?: number }>();
  private m4Drivers = new Map<string, { data: M4DriverLocation; expiresAt: number }>();

  constructor(redisUrl?: string) {
    const url = redisUrl || process.env.REDIS_URL;
    const host = process.env.REDIS_HOST || 'localhost';
    const port = Number(process.env.REDIS_PORT || 6379);

    if (process.env.DISABLE_REDIS === 'true') {
      return;
    }

    if (process.env.NODE_ENV === 'test' && !process.env.REDIS_HOST && !process.env.REDIS_URL && !redisUrl) {
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
        if (process.env.NODE_ENV !== 'test') {
          console.log(`[RedisService] Conectado exitosamente a Redis`);
        }
      });

      this.client.on('error', (err) => {
        if (this.isConnected && process.env.NODE_ENV !== 'test') {
          console.warn(`[RedisService] Error de conexión con Redis: ${err.message}`);
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

  public async init(): Promise<boolean> {
    if (this.connectionAttempted && this.isConnected) return true;
    this.connectionAttempted = true;

    if (!this.client) return false;
    try {
      await this.client.connect();
      this.isConnected = true;
      return true;
    } catch {
      this.isConnected = false;
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // 1. Gestión de Ofertas Efímeras con TTL (RF-5.3, RF-5.4, RNF-06)
  // ---------------------------------------------------------------------------

  public async saveOffer(offer: RideOffer, ttlSeconds: number): Promise<void> {
    const key = `dispatch:offer:${offer.id}`;
    if (this.isConnected && this.client) {
      try {
        await this.client.set(key, JSON.stringify(offer), 'EX', ttlSeconds);
        return;
      } catch (err: any) {
        console.warn(`[RedisService] Fallo al guardar oferta ${offer.id} en Redis: ${err.message}`);
      }
    }

    const expiresAt = Date.now() + ttlSeconds * 1000;
    this.memoryOffers.set(offer.id, { offer, expiresAt });
  }

  public async saveOfferWithTtl(offer: RideOffer, ttlSeconds: number): Promise<void> {
    return this.saveOffer(offer, ttlSeconds);
  }

  public async getOffer(offerId: string): Promise<RideOffer | null> {
    const key = `dispatch:offer:${offerId}`;
    if (this.isConnected && this.client) {
      try {
        const raw = await this.client.get(key);
        if (!raw) return null;
        return JSON.parse(raw) as RideOffer;
      } catch (err: any) {
        console.warn(`[RedisService] Fallo al recuperar oferta ${offerId} de Redis: ${err.message}`);
      }
    }

    const entry = this.memoryOffers.get(offerId);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.memoryOffers.delete(offerId);
      return null;
    }
    return entry.offer;
  }

  public async deleteOffer(offerId: string): Promise<void> {
    const key = `dispatch:offer:${offerId}`;
    if (this.isConnected && this.client) {
      try {
        await this.client.del(key);
      } catch (err: any) {
        console.warn(`[RedisService] Fallo al eliminar oferta ${offerId} de Redis: ${err.message}`);
      }
    }
    this.memoryOffers.delete(offerId);
  }

  public async getRemainingTtl(offerId: string): Promise<number> {
    const key = `dispatch:offer:${offerId}`;
    if (this.isConnected && this.client) {
      try {
        return await this.client.ttl(key);
      } catch (err: any) {
        console.warn(`[RedisService] Fallo al consultar TTL de ${offerId} en Redis: ${err.message}`);
      }
    }

    const entry = this.memoryOffers.get(offerId);
    if (!entry) return -2;
    const remainingMs = entry.expiresAt - Date.now();
    if (remainingMs <= 0) {
      this.memoryOffers.delete(offerId);
      return -2;
    }
    return Math.ceil(remainingMs / 1000);
  }

  // ---------------------------------------------------------------------------
  // 2. Distributed Locking Atómico (RF-5.5 / RNF-09)
  // ---------------------------------------------------------------------------

  public async acquireAssignmentLock(
    requestId: string,
    driverId: string,
    ttlSeconds = 30
  ): Promise<LockResult> {
    const lockKey = `dispatch:lock:request:${requestId}`;
    if (this.isConnected && this.client) {
      try {
        const result = await this.client.set(lockKey, driverId, 'EX', ttlSeconds, 'NX');
        if (result === 'OK') {
          return { acquired: true, holder: driverId };
        }
        const currentHolder = await this.client.get(lockKey);
        return { acquired: false, holder: currentHolder || undefined };
      } catch (err: any) {
        console.warn(`[RedisService] Error al adquirir lock para ${requestId}: ${err.message}`);
      }
    }

    const now = Date.now();
    const existing = this.memoryLocks.get(requestId);
    if (existing && existing.expiresAt > now) {
      return { acquired: false, holder: existing.driverId };
    }

    this.memoryLocks.set(requestId, {
      driverId,
      expiresAt: now + ttlSeconds * 1000
    });
    return { acquired: true, holder: driverId };
  }

  public async acquireLock(key: string, ttlSeconds = 30): Promise<boolean> {
    const res = await this.acquireAssignmentLock(key, 'generic_holder', ttlSeconds);
    return res.acquired;
  }

  public async releaseLock(key: string): Promise<void> {
    const lockKey = key.startsWith('dispatch:lock:') ? key : `dispatch:lock:request:${key}`;
    if (this.isConnected && this.client) {
      try {
        await this.client.del(lockKey);
      } catch {}
    }
    this.memoryLocks.delete(key);
  }

  // ---------------------------------------------------------------------------
  // 3. Candado Atómico de Cliente Activo (RNF-09)
  // ---------------------------------------------------------------------------

  public async acquireClientActiveLock(
    clientId: string,
    requestId: string,
    ttlSeconds = 180
  ): Promise<boolean> {
    const key = `active_client:${clientId}`;
    if (this.isConnected && this.client) {
      try {
        const result = await this.client.set(key, requestId, 'EX', ttlSeconds, 'NX');
        return result === 'OK';
      } catch {}
    }

    const now = Date.now();
    const existing = this.memoryFallback.get(key);
    if (existing && (!existing.expiresAt || existing.expiresAt > now)) {
      return false;
    }

    this.memoryFallback.set(key, {
      data: requestId,
      expiresAt: now + ttlSeconds * 1000
    });
    return true;
  }

  public async getActiveRequestIdForClient(clientId: string): Promise<string | null> {
    const key = `active_client:${clientId}`;
    if (this.isConnected && this.client) {
      try {
        return await this.client.get(key);
      } catch {}
    }

    const entry = this.memoryFallback.get(key);
    if (!entry) return null;
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.memoryFallback.delete(key);
      return null;
    }
    return entry.data;
  }

  public async releaseClientActiveLock(clientId: string): Promise<void> {
    const key = `active_client:${clientId}`;
    if (this.isConnected && this.client) {
      try {
        await this.client.del(key);
      } catch {}
    }
    this.memoryFallback.delete(key);
  }

  // ---------------------------------------------------------------------------
  // 4. Idempotencia Distribuida (RNF-08)
  // ---------------------------------------------------------------------------

  public async saveIdempotentRequest(
    idempotencyKey: string,
    request: RideRequest,
    ttlSeconds = 3600
  ): Promise<void> {
    const key = `idempotency:request:${idempotencyKey}`;
    const payload = JSON.stringify(request);

    if (this.isConnected && this.client) {
      try {
        await this.client.set(key, payload, 'EX', ttlSeconds);
        return;
      } catch {}
    }

    this.memoryFallback.set(key, {
      data: payload,
      expiresAt: Date.now() + ttlSeconds * 1000
    });
  }

  public async getIdempotentRequest(idempotencyKey: string): Promise<RideRequest | null> {
    const key = `idempotency:request:${idempotencyKey}`;

    if (this.isConnected && this.client) {
      try {
        const raw = await this.client.get(key);
        if (!raw) return null;
        return JSON.parse(raw) as RideRequest;
      } catch {}
    }

    const entry = this.memoryFallback.get(key);
    if (!entry) return null;
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.memoryFallback.delete(key);
      return null;
    }
    return JSON.parse(entry.data) as RideRequest;
  }

  // ---------------------------------------------------------------------------
  // 5. Caché de Estimación de Tarifas M7 (RNF-06)
  // ---------------------------------------------------------------------------

  public async cacheEstimatedFare(
    cacheKey: string,
    fare: EstimatedFare,
    ttlSeconds = 60
  ): Promise<void> {
    const key = `fare:estimate:${cacheKey}`;
    const payload = JSON.stringify(fare);

    if (this.isConnected && this.client) {
      try {
        await this.client.set(key, payload, 'EX', ttlSeconds);
        return;
      } catch {}
    }

    this.memoryFallback.set(key, {
      data: payload,
      expiresAt: Date.now() + ttlSeconds * 1000
    });
  }

  public async getCachedEstimatedFare(cacheKey: string): Promise<EstimatedFare | null> {
    const key = `fare:estimate:${cacheKey}`;

    if (this.isConnected && this.client) {
      try {
        const raw = await this.client.get(key);
        if (!raw) return null;
        return JSON.parse(raw) as EstimatedFare;
      } catch {}
    }

    const entry = this.memoryFallback.get(key);
    if (!entry) return null;
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.memoryFallback.delete(key);
      return null;
    }
    return JSON.parse(entry.data) as EstimatedFare;
  }

  // ---------------------------------------------------------------------------
  // 6. Integración Geoespacial con Módulo 4 en Redis (RF-5.2)
  // ---------------------------------------------------------------------------

  public async saveM4DriverLocation(driver: M4DriverLocation, ttlSeconds = 60): Promise<void> {
    const key = `driver:${driver.driverId}:location`;
    const payload = JSON.stringify(driver);

    if (this.isConnected && this.client) {
      try {
        await this.client.set(key, payload, 'EX', ttlSeconds);
        return;
      } catch {}
    }

    this.m4Drivers.set(driver.driverId, {
      data: driver,
      expiresAt: Date.now() + ttlSeconds * 1000
    });
  }

  public async findNearbyDriversFromM4(
    originLat: number,
    originLng: number,
    vehicleType: VehicleType,
    radiusKm = 5.0
  ): Promise<NearbyDriverStub[]> {
    const driversList: M4DriverLocation[] = [];

    if (this.isConnected && this.client) {
      try {
        const keys = await this.client.keys('driver:*:location');
        for (const key of keys) {
          const raw = await this.client.get(key);
          if (raw) {
            try {
              driversList.push(JSON.parse(raw));
            } catch {}
          }
        }
      } catch {}
    } else {
      const now = Date.now();
      for (const [driverId, entry] of this.m4Drivers.entries()) {
        if (entry.expiresAt > now) {
          driversList.push(entry.data);
        } else {
          this.m4Drivers.delete(driverId);
        }
      }
    }

    const candidates: NearbyDriverStub[] = [];
    for (const driver of driversList) {
      if (driver.available === false) continue;
      if (driver.vehicleType && driver.vehicleType.toUpperCase() !== vehicleType.toUpperCase()) continue;

      const distanceMeters = RideRequestValidator.calculateDistanceMeters(
        { latitude: originLat, longitude: originLng, address: '' },
        { latitude: driver.latitude, longitude: driver.longitude, address: '' }
      );
      const distanceKm = distanceMeters / 1000;

      if (distanceKm <= radiusKm) {
        candidates.push({
          driverId: driver.driverId,
          distanceKm: Math.round(distanceKm * 100) / 100,
          vehicleType: (driver.vehicleType?.toUpperCase() === 'MOTO' ? 'MOTO' : 'AUTO') as VehicleType,
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
      } catch {}
    }
    this.m4Drivers.clear();
  }

  // ---------------------------------------------------------------------------
  // Utilidades y Limpieza
  // ---------------------------------------------------------------------------

  public clearFallback(): void {
    this.memoryOffers.clear();
    this.memoryLocks.clear();
    this.memoryFallback.clear();
    this.m4Drivers.clear();
  }

  public async isHealthy(): Promise<boolean> {
    return this.isConnected;
  }

  public async close(): Promise<void> {
    await this.disconnect();
  }

  public async disconnect(): Promise<void> {
    if (this.client) {
      try {
        await this.client.quit();
      } catch {
        this.client.disconnect();
      } finally {
        this.client = null;
        this.isConnected = false;
      }
    }
  }
}
