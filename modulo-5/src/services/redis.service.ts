import Redis from 'ioredis';
import { RideRequest, EstimatedFare } from '../types/ride-request.types';

/**
 * Servicio de Gestión de Estado Efímero y Caché con Redis (RNF-06, RNF-08, RNF-09)
 * Maneja:
 * 1. Idempotencia distribuida con TTL (RNF-08)
 * 2. Candado atómico contra concurrencia de cliente (RNF-09) con expiración e invalidación (Criterio 6)
 * 3. Caché de estimación de tarifas del Módulo 7
 * 4. Modo resiliente con fallback en memoria cuando Redis no está disponible o en entorno de tests
 */
export class RedisService {
  private client: Redis | null = null;
  private isConnected = false;
  private connectionAttempted = false;

  // Almacenamiento en memoria para fallback resiliente (evita caídas si Redis está temporalmente offline)
  private fallbackMemory: Map<string, { value: string; expiresAt?: number }> = new Map();

  constructor(redisUrl?: string) {
    const url = redisUrl || process.env.REDIS_URL;
    const host = process.env.REDIS_HOST || 'localhost';
    const port = Number(process.env.REDIS_PORT || 6379);

    // Si estamos en testing sin REDIS_HOST explícito, operamos en memoria sin warnings
    if (process.env.NODE_ENV === 'test' && !process.env.REDIS_HOST && !process.env.REDIS_URL) {
      this.client = null;
      return;
    }

    try {
      this.client = url
        ? new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 1, enableOfflineQueue: false })
        : new Redis({
            host,
            port,
            lazyConnect: true,
            maxRetriesPerRequest: 1,
            enableOfflineQueue: false,
            connectTimeout: 2000
          });

      this.client.on('connect', () => {
        this.isConnected = true;
        console.log(`[RedisService] Conectado exitosamente a Redis (${host}:${port})`);
      });

      this.client.on('error', (err) => {
        this.isConnected = false;
        // Solo logueamos la primera vez para no ensuciar la consola
        if (!this.connectionAttempted) {
          console.warn(`[RedisService] Redis no disponible en ${host}:${port}. Activando modo degradado con fallback en memoria.`);
        }
      });
    } catch (error) {
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
    } catch (err) {
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
    } catch (err) {
      // Fallback a memoria
    }

    // Modo fallback
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
    } catch (err) {
      // Fallback a memoria
    }

    // Modo fallback
    this.fallbackMemory.set(key, {
      value: serialized,
      expiresAt: Date.now() + ttlSeconds * 1000
    });
  }

  // ==========================================================================
  // CANDADO ATÓMICO DE CLIENTE ACTIVO (RNF-09 - Criterios 6 y 7)
  // Operación SET ... NX EX para evitar solicitudes concurrentes simultáneas
  // ==========================================================================

  /**
   * Intenta adquirir un bloqueo atómico de solicitud activa para un cliente.
   * Utiliza el comando SET key value NX EX ttl (atómico).
   * Retorna true si adquirió el candado (el cliente estaba libre),
   * o false si ya existía una solicitud activa (evita race conditions).
   */
  public async acquireClientActiveLock(
    clientId: string,
    requestId: string,
    ttlSeconds = 180
  ): Promise<boolean> {
    const key = `m5:active_client:${clientId}`;

    try {
      if (this.isConnected && this.client) {
        // SET ... NX (Not eXists) EX (TTL en segundos)
        const result = await this.client.set(key, requestId, 'EX', ttlSeconds, 'NX');
        return result === 'OK';
      }
    } catch (err) {
      // Fallback a memoria
    }

    // Modo fallback atómico en memoria
    const item = this.fallbackMemory.get(key);
    const now = Date.now();
    if (item && (!item.expiresAt || item.expiresAt > now)) {
      return false; // Ya existe y no expiró
    }

    this.fallbackMemory.set(key, {
      value: requestId,
      expiresAt: now + ttlSeconds * 1000
    });
    return true;
  }

  /**
   * Actualiza el ID de la solicitud en el candado existente (sin perder el TTL restante)
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
    } catch (err) {
      // Fallback
    }
    this.fallbackMemory.set(key, {
      value: requestId,
      expiresAt: Date.now() + ttlSeconds * 1000
    });
  }

  /**
   * Invalida y libera explícitamente el candado de solicitud activa del cliente (Criterio 6: Invalidación)
   */
  public async releaseClientActiveLock(clientId: string): Promise<void> {
    const key = `m5:active_client:${clientId}`;
    try {
      if (this.isConnected && this.client) {
        await this.client.del(key);
        return;
      }
    } catch (err) {
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
    } catch (err) {
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

  /**
   * Guarda una estimación de tarifa en caché con TTL corto (ej. 60s)
   */
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
    } catch (err) {
      // Fallback
    }

    this.fallbackMemory.set(key, {
      value: serialized,
      expiresAt: Date.now() + ttlSeconds * 1000
    });
  }

  /**
   * Obtiene una estimación de tarifa cacheada
   */
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
    } catch (err) {
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
