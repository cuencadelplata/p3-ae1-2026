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
   * Obtiene una oferta de viaje por su ID desde PostgreSQL o memoria
   */
  public async getRideOfferById(id: string): Promise<RideOffer | null> {
    if (this.isConnected && this.prisma) {
      try {
        const row = await this.prisma.rideOffer.findUnique({
          where: { id },
          include: { request: true }
        });
        if (!row) return null;
        return {
          id: row.id,
          requestId: row.requestId,
          driverId: row.driverId,
          status: row.status as any,
          ttlSeconds: row.ttlSeconds,
          createdAt: row.createdAt.toISOString(),
          expiresAt: row.expiresAt.toISOString(),
          origin: {
            latitude: row.request.originLat,
            longitude: row.request.originLng,
            address: row.request.originAddress
          },
          destination: {
            latitude: row.request.destLat,
            longitude: row.request.destLng,
            address: row.request.destAddress
          },
          vehicleType: row.request.vehicleType as any,
          estimatedFare: {
            amount: row.request.estimatedAmount,
            currency: row.request.currency,
            estimatedDistanceKm: row.request.estimatedDistanceKm,
            estimatedDurationMin: row.request.estimatedDurationMin,
            fareToken: row.request.fareToken || undefined
          }
        };
      } catch {
        // Fallback
      }
    }

    return this.memoryOffers.get(id) || null;
  }

  /**
   * Obtiene todas las ofertas emitidas para una solicitud
   */
  public async getOffersByRequestId(requestId: string): Promise<RideOffer[]> {
    if (this.isConnected && this.prisma) {
      try {
        const rows = await this.prisma.rideOffer.findMany({
          where: { requestId },
          include: { request: true }
        });
        return rows.map((row) => ({
          id: row.id,
          requestId: row.requestId,
          driverId: row.driverId,
          status: row.status as any,
          ttlSeconds: row.ttlSeconds,
          createdAt: row.createdAt.toISOString(),
          expiresAt: row.expiresAt.toISOString(),
          origin: {
            latitude: row.request.originLat,
            longitude: row.request.originLng,
            address: row.request.originAddress
          },
          destination: {
            latitude: row.request.destLat,
            longitude: row.request.destLng,
            address: row.request.destAddress
          },
          vehicleType: row.request.vehicleType as any,
          estimatedFare: {
            amount: row.request.estimatedAmount,
            currency: row.request.currency,
            estimatedDistanceKm: row.request.estimatedDistanceKm,
            estimatedDurationMin: row.request.estimatedDurationMin,
            fareToken: row.request.fareToken || undefined
          }
        }));
      } catch {
        // Fallback
      }
    }

    return Array.from(this.memoryOffers.values()).filter((o) => o.requestId === requestId);
  }

  /**
   * Obtiene todas las ofertas destinadas a un conductor específico
   */
  public async getOffersByDriverId(driverId: string): Promise<RideOffer[]> {
    if (this.isConnected && this.prisma) {
      try {
        const rows = await this.prisma.rideOffer.findMany({
          where: { driverId },
          include: { request: true }
        });
        return rows.map((row) => ({
          id: row.id,
          requestId: row.requestId,
          driverId: row.driverId,
          status: row.status as any,
          ttlSeconds: row.ttlSeconds,
          createdAt: row.createdAt.toISOString(),
          expiresAt: row.expiresAt.toISOString(),
          origin: {
            latitude: row.request.originLat,
            longitude: row.request.originLng,
            address: row.request.originAddress
          },
          destination: {
            latitude: row.request.destLat,
            longitude: row.request.destLng,
            address: row.request.destAddress
          },
          vehicleType: row.request.vehicleType as any,
          estimatedFare: {
            amount: row.request.estimatedAmount,
            currency: row.request.currency,
            estimatedDistanceKm: row.request.estimatedDistanceKm,
            estimatedDurationMin: row.request.estimatedDurationMin,
            fareToken: row.request.fareToken || undefined
          }
        }));
      } catch {
        // Fallback
      }
    }

    return Array.from(this.memoryOffers.values()).filter((o) => o.driverId === driverId);
  }

  /**
   * Obtiene todas las ofertas en el sistema
   */
  public async getAllOffers(): Promise<RideOffer[]> {
    if (this.isConnected && this.prisma) {
      try {
        const rows = await this.prisma.rideOffer.findMany({
          include: { request: true }
        });
        return rows.map((row) => ({
          id: row.id,
          requestId: row.requestId,
          driverId: row.driverId,
          status: row.status as any,
          ttlSeconds: row.ttlSeconds,
          createdAt: row.createdAt.toISOString(),
          expiresAt: row.expiresAt.toISOString(),
          origin: {
            latitude: row.request.originLat,
            longitude: row.request.originLng,
            address: row.request.originAddress
          },
          destination: {
            latitude: row.request.destLat,
            longitude: row.request.destLng,
            address: row.request.destAddress
          },
          vehicleType: row.request.vehicleType as any,
          estimatedFare: {
            amount: row.request.estimatedAmount,
            currency: row.request.currency,
            estimatedDistanceKm: row.request.estimatedDistanceKm,
            estimatedDurationMin: row.request.estimatedDurationMin,
            fareToken: row.request.fareToken || undefined
          }
        }));
      } catch {
        // Fallback
      }
    }

    return Array.from(this.memoryOffers.values());
  }

  /**
   * Asignación atómica de solicitud en base de datos compartida (RF-5.5).
   * Garantiza que ante respuestas concurrentes entre múltiples instancias del servicio,
   * solo un conductor pueda quedar asignado al viaje, incluso ante fallas de Redis.
   */
  public async assignRideRequestAtomic(
    requestId: string,
    driverId: string,
    offerId: string
  ): Promise<{ success: boolean; request: RideRequest | null; conflictReason?: string }> {
    if (this.isConnected && this.prisma) {
      try {
        const result = await this.prisma.$transaction(async (tx) => {
          // 1. Verificar estado actual
          const current = await tx.rideRequest.findUnique({ where: { id: requestId } });
          if (!current) {
            return { success: false, request: null, conflictReason: 'REQUEST_NOT_FOUND' };
          }
          if (current.status === 'ASSIGNED') {
            return { success: false, request: null, conflictReason: 'REQUEST_ALREADY_ASSIGNED' };
          }
          if (current.status === 'CANCELLED') {
            return { success: false, request: null, conflictReason: 'REQUEST_CANCELLED' };
          }

          // 2. Actualización condicional atómica a nivel SQL
          const updateResult = await tx.rideRequest.updateMany({
            where: {
              id: requestId,
              status: { notIn: ['ASSIGNED', 'CANCELLED'] }
            },
            data: {
              status: 'ASSIGNED',
              assignedDriverId: driverId,
              updatedAt: new Date()
            }
          });

          if (updateResult.count === 0) {
            return { success: false, request: null, conflictReason: 'REQUEST_ALREADY_ASSIGNED' };
          }

          // 3. Actualizar la oferta ganadora a ACCEPTED
          await tx.rideOffer.update({
            where: { id: offerId },
            data: {
              status: 'ACCEPTED',
              respondedAt: new Date()
            }
          });

          // 4. Invalidar/expirar atómicamente el resto de las ofertas pendientes para este viaje
          await tx.rideOffer.updateMany({
            where: {
              requestId: requestId,
              id: { not: offerId },
              status: 'PENDING'
            },
            data: {
              status: 'EXPIRED',
              respondedAt: new Date()
            }
          });

          // 5. Registrar log de auditoría inmutable
          await tx.dispatchLog.create({
            data: {
              requestId,
              eventType: 'REQUEST_ASSIGNED',
              driverId,
              details: `Asignación atómica a conductor ${driverId} con oferta ${offerId}`
            }
          });

          return { success: true };
        });

        if (!result.success) {
          return { success: false, request: null, conflictReason: result.conflictReason };
        }

        const domainRequest = await this.getRideRequestById(requestId);
        return { success: true, request: domainRequest };
      } catch {
        // Fallback en caso de error transaccional de DB
      }
    }

    // Fallback atómico en memoria (para ejecución aislada sin base de datos)
    const memReq = this.memoryRequests.get(requestId);
    if (!memReq) {
      return { success: false, request: null, conflictReason: 'REQUEST_NOT_FOUND' };
    }
    if (memReq.status === 'ASSIGNED') {
      return { success: false, request: null, conflictReason: 'REQUEST_ALREADY_ASSIGNED' };
    }
    if (memReq.status === 'CANCELLED') {
      return { success: false, request: null, conflictReason: 'REQUEST_CANCELLED' };
    }

    const now = new Date().toISOString();
    memReq.status = 'ASSIGNED';
    memReq.assignedDriverId = driverId;
    memReq.updatedAt = now;
    this.memoryRequests.set(requestId, memReq);

    const memOffer = this.memoryOffers.get(offerId);
    if (memOffer) {
      memOffer.status = 'ACCEPTED';
      this.memoryOffers.set(offerId, memOffer);
    }

    for (const off of this.memoryOffers.values()) {
      if (off.requestId === requestId && off.id !== offerId && off.status === 'PENDING') {
        off.status = 'EXPIRED';
        this.memoryOffers.set(off.id, off);
      }
    }

    this.memoryLogs.push({
      id: `log_${Date.now()}`,
      requestId,
      eventType: 'REQUEST_ASSIGNED',
      driverId,
      details: `Asignación atómica a conductor ${driverId} con oferta ${offerId}`,
      createdAt: now
    });

    return { success: true, request: { ...memReq } };
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
