import { PrismaClient } from '@prisma/client';
import { RideRequest, RideOffer } from '../types/ride-request.types';

/**
 * Servicio de Persistencia Relacional para Módulo 5 (DispatchDB)
 * Implementa persistencia en PostgreSQL usando Prisma ORM.
 * Incluye modo append-only para auditoría (DispatchLog) y fallback en memoria.
 */
export class DbService {
  private prisma: PrismaClient | null = null;
  private isConnected = false;

  // Fallback en memoria si la base de datos no está disponible (ej. tests unitarios)
  private memoryRequests = new Map<string, RideRequest>();
  private memoryOffers = new Map<string, RideOffer>();
  private memoryLogs: Array<{ id: string; requestId: string; eventType: string; driverId?: string; details?: string; createdAt: string }> = [];

  constructor() {
    this.initPrisma();
  }

  private initPrisma(): void {
    try {
      this.prisma = new PrismaClient({
        log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error']
      });

      this.prisma
        .$connect()
        .then(() => {
          this.isConnected = true;
          console.log('[DbService] Conectado exitosamente a PostgreSQL (DispatchDB).');
        })
        .catch(() => {
          this.isConnected = false;
          this.prisma = null;
        });
    } catch {
      this.isConnected = false;
      this.prisma = null;
    }
  }

  /**
   * Guarda o actualiza una solicitud de viaje en PostgreSQL
   */
  public async saveRideRequest(request: RideRequest): Promise<RideRequest> {
    if (this.isConnected && this.prisma) {
      try {
        await this.prisma.rideRequest.upsert({
          where: { id: request.id },
          create: {
            id: request.id,
            clientId: request.clientId,
            originLat: request.origin.latitude,
            originLng: request.origin.longitude,
            originAddress: request.origin.address,
            destLat: request.destination.latitude,
            destLng: request.destination.longitude,
            destAddress: request.destination.address,
            vehicleType: request.vehicleType,
            status: request.status,
            estimatedAmount: request.estimatedFare.amount,
            currency: request.estimatedFare.currency,
            estimatedDistanceKm: request.estimatedFare.estimatedDistanceKm,
            estimatedDurationMin: request.estimatedFare.estimatedDurationMin,
            fareToken: request.estimatedFare.fareToken,
            assignedDriverId: request.assignedDriverId,
            idempotencyKey: request.idempotencyKey,
            createdAt: new Date(request.createdAt),
            updatedAt: new Date(request.updatedAt),
            expiresAt: new Date(request.expiresAt),
            cancelledAt: request.cancelledAt ? new Date(request.cancelledAt) : null,
            cancellationReason: request.cancellationReason
          },
          update: {
            status: request.status,
            assignedDriverId: request.assignedDriverId,
            updatedAt: new Date(request.updatedAt),
            cancelledAt: request.cancelledAt ? new Date(request.cancelledAt) : null,
            cancellationReason: request.cancellationReason
          }
        });
        return request;
      } catch {
        // Fallback
      }
    }

    this.memoryRequests.set(request.id, { ...request });
    return request;
  }

  /**
   * Busca una solicitud por ID
   */
  public async getRideRequestById(id: string): Promise<RideRequest | null> {
    if (this.isConnected && this.prisma) {
      try {
        const row = await this.prisma.rideRequest.findUnique({ where: { id } });
        if (!row) return null;

        return {
          id: row.id,
          clientId: row.clientId,
          origin: {
            latitude: row.originLat,
            longitude: row.originLng,
            address: row.originAddress
          },
          destination: {
            latitude: row.destLat,
            longitude: row.destLng,
            address: row.destAddress
          },
          vehicleType: row.vehicleType as 'AUTO' | 'MOTO',
          status: row.status as any,
          estimatedFare: {
            amount: row.estimatedAmount,
            currency: row.currency,
            estimatedDistanceKm: row.estimatedDistanceKm,
            estimatedDurationMin: row.estimatedDurationMin,
            fareToken: row.fareToken || undefined
          },
          assignedDriverId: row.assignedDriverId,
          idempotencyKey: row.idempotencyKey,
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
          expiresAt: row.expiresAt.toISOString(),
          cancelledAt: row.cancelledAt?.toISOString(),
          cancellationReason: row.cancellationReason || undefined
        };
      } catch {
        // Fallback
      }
    }

    return this.memoryRequests.get(id) || null;
  }

  /**
   * Busca solicitud por Idempotency-Key
   */
  public async getRideRequestByIdempotencyKey(key: string): Promise<RideRequest | null> {
    if (this.isConnected && this.prisma) {
      try {
        const row = await this.prisma.rideRequest.findUnique({ where: { idempotencyKey: key } });
        if (!row) return null;
        return this.getRideRequestById(row.id);
      } catch {
        // Fallback
      }
    }

    for (const req of this.memoryRequests.values()) {
      if (req.idempotencyKey === key) return req;
    }
    return null;
  }

  /**
   * Registra una oferta despachada en la base de datos
   */
  public async saveRideOffer(offer: RideOffer): Promise<RideOffer> {
    if (this.isConnected && this.prisma) {
      try {
        await this.prisma.rideOffer.upsert({
          where: { id: offer.id },
          create: {
            id: offer.id,
            requestId: offer.requestId,
            driverId: offer.driverId,
            status: offer.status,
            ttlSeconds: offer.ttlSeconds,
            createdAt: new Date(offer.createdAt),
            expiresAt: new Date(offer.expiresAt),
            respondedAt: null
          },
          update: {
            status: offer.status,
            respondedAt: new Date()
          }
        });
        return offer;
      } catch {
        // Fallback
      }
    }

    this.memoryOffers.set(offer.id, { ...offer });
    return offer;
  }

  /**
   * Registra un log de auditoría append-only
   */
  public async logDispatchEvent(requestId: string, eventType: string, driverId?: string, details?: string): Promise<void> {
    if (this.isConnected && this.prisma) {
      try {
        await this.prisma.dispatchLog.create({
          data: {
            requestId,
            eventType,
            driverId,
            details
          }
        });
        return;
      } catch {
        // Fallback
      }
    }

    this.memoryLogs.push({
      id: `log_${Date.now()}`,
      requestId,
      eventType,
      driverId,
      details,
      createdAt: new Date().toISOString()
    });
  }

  /**
   * Cierra limpiamente la conexión a Prisma
   */
  public async disconnect(): Promise<void> {
    if (this.isConnected && this.prisma) {
      try {
        await this.prisma.$disconnect();
      } catch {
        // Ignore
      } finally {
        this.isConnected = false;
        this.prisma = null;
      }
    }
  }
}
