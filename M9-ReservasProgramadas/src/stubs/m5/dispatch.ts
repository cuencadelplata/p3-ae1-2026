import { randomUUID } from 'node:crypto';

import type { TipoVehiculo } from '../../domain/reserva.js';
import type { GeoLocation } from '../../integration/route-estimate.port.js';

export type RideStatus =
  | 'PENDING'
  | 'SEARCHING'
  | 'OFFERED'
  | 'ASSIGNED'
  | 'EXPIRED'
  | 'NO_DRIVERS_AVAILABLE'
  | 'CANCELLED';

export type OfferStatus = 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'EXPIRED';
export type OfferAction = 'ACCEPT' | 'REJECT';

export interface CandidateDriverStub {
  driverId: string;
  vehicleType: TipoVehiculo;
  distanceKm: number;
  estimatedEtaMinutes: number;
  rating: number;
  available: boolean;
}

export interface RideRequestStub {
  id: string;
  clientId: string;
  origin: GeoLocation;
  destination: GeoLocation;
  vehicleType: TipoVehiculo;
  status: RideStatus;
  assignedDriverId: string | null;
  estimatedFare: {
    amount: number;
    currency: string;
    estimatedDistanceKm: number;
    estimatedDurationMin: number;
  };
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
}

export interface RideOfferStub {
  id: string;
  requestId: string;
  driverId: string;
  status: OfferStatus;
  estimatedFare: RideRequestStub['estimatedFare'];
  origin: GeoLocation;
  destination: GeoLocation;
  vehicleType: TipoVehiculo;
  ttlSeconds: number;
  createdAt: string;
  expiresAt: string;
  respondedAt: string | null;
}

export interface DispatchContext {
  reservationId: string;
  correlationId: string;
}

export interface M5StubState {
  rideRequests: Map<string, RideRequestStub>;
  idempotencyRequests: Map<string, string>;
  drivers: Map<string, CandidateDriverStub>;
  offers: Map<string, RideOfferStub>;
  requestOfferIds: Map<string, string[]>;
  dispatchContexts: Map<string, DispatchContext>;
}

export type DispatchOutcome =
  | { type: 'ASSIGNED'; ride: RideRequestStub; context: DispatchContext }
  | {
      type: 'FAILED';
      ride: RideRequestStub;
      context: DispatchContext;
      reason: 'EXPIRED' | 'NO_DRIVERS_AVAILABLE';
    };

export class M5StubError extends Error {
  public constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const defaultDrivers = (): CandidateDriverStub[] => [
  {
    driverId: '30000000-0000-4000-8000-000000000001',
    vehicleType: 'AUTO',
    distanceKm: 1.2,
    estimatedEtaMinutes: 4,
    rating: 4.9,
    available: true,
  },
  {
    driverId: '30000000-0000-4000-8000-000000000002',
    vehicleType: 'AUTO',
    distanceKm: 0.8,
    estimatedEtaMinutes: 3,
    rating: 4.7,
    available: true,
  },
  {
    driverId: '30000000-0000-4000-8000-000000000003',
    vehicleType: 'AUTO',
    distanceKm: 2,
    estimatedEtaMinutes: 6,
    rating: 4.5,
    available: true,
  },
  {
    driverId: '30000000-0000-4000-8000-000000000004',
    vehicleType: 'MOTO',
    distanceKm: 1.5,
    estimatedEtaMinutes: 4,
    rating: 4.8,
    available: true,
  },
  {
    driverId: '30000000-0000-4000-8000-000000000005',
    vehicleType: 'MOTO',
    distanceKm: 0.7,
    estimatedEtaMinutes: 2,
    rating: 4.6,
    available: true,
  },
];

export const createM5StubState = (
  drivers: CandidateDriverStub[] = defaultDrivers(),
): M5StubState => ({
  rideRequests: new Map(),
  idempotencyRequests: new Map(),
  drivers: new Map(drivers.map((driver) => [driver.driverId, driver])),
  offers: new Map(),
  requestOfferIds: new Map(),
  dispatchContexts: new Map(),
});

export interface CreateRideRequestStubInput {
  origin: GeoLocation;
  destination: GeoLocation;
  vehicleType: TipoVehiculo;
}

export interface CandidateSearchOptions {
  radiusKm?: number;
  maxCandidates?: number;
}

export interface SendOffersOptions {
  driverIds?: string[];
  ttlSeconds?: number;
}

export interface OfferResponse {
  offerId: string;
  requestId: string;
  driverId: string;
  action: OfferAction;
  status: OfferStatus;
  requestStatus: RideStatus;
  assignedDriverId: string | null;
  message: string;
  respondedAt: string;
}

type OutcomeHandler = (outcome: DispatchOutcome) => Promise<void>;

const noOutcome: OutcomeHandler = async () => undefined;

export class M5StubDispatchService {
  private readonly offerTimers = new Map<string, NodeJS.Timeout>();

  public constructor(
    public readonly state: M5StubState = createM5StubState(),
    private readonly onOutcome: OutcomeHandler = noOutcome,
    private readonly now: () => Date = () => new Date(),
  ) {}

  public createRequest(
    input: CreateRideRequestStubInput,
    idempotencyKey: string,
    context?: DispatchContext,
  ): RideRequestStub {
    const existingId = this.state.idempotencyRequests.get(idempotencyKey);
    if (existingId !== undefined) return this.requireRide(existingId);

    const now = this.now();
    const ride: RideRequestStub = {
      id: randomUUID(),
      clientId: 'm9-scheduled-reservation',
      ...input,
      status: 'SEARCHING',
      assignedDriverId: null,
      estimatedFare: {
        amount: 0,
        currency: 'ARS',
        estimatedDistanceKm: 0,
        estimatedDurationMin: 0,
      },
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 180_000).toISOString(),
    };
    this.state.rideRequests.set(ride.id, ride);
    this.state.idempotencyRequests.set(idempotencyKey, ride.id);
    if (context !== undefined) this.state.dispatchContexts.set(ride.id, context);
    return ride;
  }

  public getRequest(requestId: string): RideRequestStub {
    return this.requireRide(requestId);
  }

  public searchCandidates(
    requestId: string,
    options: CandidateSearchOptions = {},
  ): CandidateDriverStub[] {
    const ride = this.requireRide(requestId);
    this.requireDispatchable(ride);
    const radiusKm = options.radiusKm ?? 5;
    const maxCandidates = options.maxCandidates ?? 5;
    const candidates = [...this.state.drivers.values()]
      .filter(
        (driver) =>
          driver.available &&
          driver.vehicleType === ride.vehicleType &&
          driver.distanceKm <= radiusKm,
      )
      .sort(
        (left, right) =>
          right.rating - left.rating ||
          left.distanceKm - right.distanceKm ||
          left.driverId.localeCompare(right.driverId),
      )
      .slice(0, maxCandidates);

    return candidates;
  }

  public async sendOffers(
    requestId: string,
    options: SendOffersOptions = {},
  ): Promise<RideOfferStub[]> {
    return this.sendOffersInternal(requestId, options, 'NO_DRIVERS_AVAILABLE');
  }

  private async sendOffersInternal(
    requestId: string,
    options: SendOffersOptions,
    terminalReason: 'EXPIRED' | 'NO_DRIVERS_AVAILABLE',
  ): Promise<RideOfferStub[]> {
    const ride = this.requireRide(requestId);
    this.requireDispatchable(ride);
    if (this.pendingOffers(requestId).length > 0) {
      throw new M5StubError(409, 'ACTIVE_OFFER_EXISTS', 'La solicitud ya tiene una oferta activa.');
    }

    const candidates = this.searchCandidates(requestId);
    const offeredDrivers = new Set(this.getOffers(requestId).map(({ driverId }) => driverId));
    const requested = options.driverIds;
    const selected =
      requested === undefined
        ? candidates.filter(({ driverId }) => !offeredDrivers.has(driverId)).slice(0, 1)
        : requested.map((driverId) => {
            const candidate = candidates.find((driver) => driver.driverId === driverId);
            if (candidate === undefined) {
              throw new M5StubError(
                404,
                'DRIVER_NOT_AVAILABLE',
                `El conductor ${driverId} no es un candidato disponible.`,
              );
            }
            if (offeredDrivers.has(driverId)) {
              throw new M5StubError(
                409,
                'DRIVER_ALREADY_OFFERED',
                `El conductor ${driverId} ya recibió esta solicitud.`,
              );
            }
            return candidate;
          });

    if (selected.length === 0) {
      ride.status = terminalReason === 'EXPIRED' ? 'EXPIRED' : 'NO_DRIVERS_AVAILABLE';
      ride.updatedAt = this.now().toISOString();
      await this.emitFailure(ride, terminalReason);
      throw new M5StubError(404, 'NO_DRIVERS_AVAILABLE', 'No quedan conductores para ofertar.');
    }

    const ttlSeconds = options.ttlSeconds ?? 30;
    const created = selected.map((driver) => this.createOffer(ride, driver, ttlSeconds));
    ride.status = 'OFFERED';
    ride.updatedAt = this.now().toISOString();
    return created;
  }

  public getOffers(requestId: string): RideOfferStub[] {
    this.requireRide(requestId);
    return (this.state.requestOfferIds.get(requestId) ?? []).map((id) => this.requireOffer(id));
  }

  public getOffer(offerId: string): RideOfferStub {
    return this.requireOffer(offerId);
  }

  public async respondToOffer(
    offerId: string,
    action: OfferAction,
    driverId?: string,
  ): Promise<OfferResponse> {
    const offer = this.requireOffer(offerId);
    const ride = this.requireRide(offer.requestId);
    if (driverId !== undefined && driverId !== offer.driverId) {
      throw new M5StubError(403, 'FORBIDDEN', 'La oferta pertenece a otro conductor.');
    }
    if (ride.status === 'ASSIGNED') {
      throw new M5StubError(409, 'REQUEST_ALREADY_ASSIGNED', 'El viaje ya fue asignado.');
    }
    if (offer.status !== 'PENDING') {
      throw new M5StubError(409, 'OFFER_ALREADY_RESPONDED', 'La oferta ya fue respondida.');
    }
    if (Date.parse(offer.expiresAt) <= this.now().getTime()) {
      await this.expireOffer(offer);
      throw new M5StubError(409, 'OFFER_EXPIRED', 'La oferta ha expirado.');
    }

    this.clearOfferTimer(offer.id);
    const respondedAt = this.now().toISOString();
    offer.status = action === 'ACCEPT' ? 'ACCEPTED' : 'REJECTED';
    offer.respondedAt = respondedAt;

    if (action === 'ACCEPT') {
      ride.status = 'ASSIGNED';
      ride.assignedDriverId = offer.driverId;
      ride.updatedAt = respondedAt;
      this.expireOtherPendingOffers(ride.id, offer.id, respondedAt);
      await this.emitAssigned(ride);
    } else {
      ride.status = 'SEARCHING';
      ride.updatedAt = respondedAt;
      await this.advanceToNextCandidate(ride);
    }

    return {
      offerId: offer.id,
      requestId: ride.id,
      driverId: offer.driverId,
      action,
      status: offer.status,
      requestStatus: ride.status,
      assignedDriverId: ride.assignedDriverId,
      message:
        action === 'ACCEPT'
          ? `Oferta aceptada. Viaje asignado al conductor ${offer.driverId}.`
          : `Oferta rechazada por ${offer.driverId}.`,
      respondedAt,
    };
  }

  public cancelRequest(requestId: string): RideRequestStub {
    const ride = this.requireRide(requestId);
    if (ride.status === 'ASSIGNED' || ride.status === 'CANCELLED' || ride.status === 'EXPIRED') {
      throw new M5StubError(409, 'INVALID_STATE', 'La solicitud ya no puede cancelarse.');
    }
    const now = this.now().toISOString();
    ride.status = 'CANCELLED';
    ride.updatedAt = now;
    this.expireOtherPendingOffers(ride.id, '', now);
    return ride;
  }

  private createOffer(
    ride: RideRequestStub,
    driver: CandidateDriverStub,
    ttlSeconds: number,
  ): RideOfferStub {
    const now = this.now();
    const offer: RideOfferStub = {
      id: randomUUID(),
      requestId: ride.id,
      driverId: driver.driverId,
      status: 'PENDING',
      estimatedFare: ride.estimatedFare,
      origin: ride.origin,
      destination: ride.destination,
      vehicleType: ride.vehicleType,
      ttlSeconds,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + ttlSeconds * 1_000).toISOString(),
      respondedAt: null,
    };
    this.state.offers.set(offer.id, offer);
    const ids = this.state.requestOfferIds.get(ride.id) ?? [];
    ids.push(offer.id);
    this.state.requestOfferIds.set(ride.id, ids);
    const timer = setTimeout(() => {
      void this.expireOffer(offer).catch(() => undefined);
    }, ttlSeconds * 1_000);
    timer.unref();
    this.offerTimers.set(offer.id, timer);
    return offer;
  }

  private async expireOffer(offer: RideOfferStub): Promise<void> {
    if (offer.status !== 'PENDING') return;
    this.clearOfferTimer(offer.id);
    offer.status = 'EXPIRED';
    offer.respondedAt = this.now().toISOString();
    const ride = this.requireRide(offer.requestId);
    ride.status = 'SEARCHING';
    ride.updatedAt = offer.respondedAt;
    await this.advanceToNextCandidate(ride, 'EXPIRED');
  }

  private async advanceToNextCandidate(
    ride: RideRequestStub,
    terminalReason: 'EXPIRED' | 'NO_DRIVERS_AVAILABLE' = 'NO_DRIVERS_AVAILABLE',
  ): Promise<void> {
    if (this.pendingOffers(ride.id).length > 0) {
      ride.status = 'OFFERED';
      return;
    }
    try {
      await this.sendOffersInternal(ride.id, {}, terminalReason);
    } catch (error) {
      if (!(error instanceof M5StubError) || error.code !== 'NO_DRIVERS_AVAILABLE') throw error;
    }
  }

  private pendingOffers(requestId: string): RideOfferStub[] {
    return this.getOffers(requestId).filter(({ status }) => status === 'PENDING');
  }

  private expireOtherPendingOffers(requestId: string, acceptedOfferId: string, at: string): void {
    for (const offer of this.getOffers(requestId)) {
      if (offer.id !== acceptedOfferId && offer.status === 'PENDING') {
        this.clearOfferTimer(offer.id);
        offer.status = 'EXPIRED';
        offer.respondedAt = at;
      }
    }
  }

  private clearOfferTimer(offerId: string): void {
    const timer = this.offerTimers.get(offerId);
    if (timer !== undefined) clearTimeout(timer);
    this.offerTimers.delete(offerId);
  }

  private requireDispatchable(ride: RideRequestStub): void {
    if (!['PENDING', 'SEARCHING', 'OFFERED'].includes(ride.status)) {
      throw new M5StubError(
        409,
        'INVALID_REQUEST_STATE',
        `La solicitud está en estado ${ride.status}.`,
      );
    }
  }

  private requireRide(requestId: string): RideRequestStub {
    const ride = this.state.rideRequests.get(requestId);
    if (ride === undefined) {
      throw new M5StubError(404, 'NOT_FOUND', 'Solicitud no encontrada.');
    }
    return ride;
  }

  private requireOffer(offerId: string): RideOfferStub {
    const offer = this.state.offers.get(offerId);
    if (offer === undefined) throw new M5StubError(404, 'NOT_FOUND', 'Oferta no encontrada.');
    return offer;
  }

  private async emitAssigned(ride: RideRequestStub): Promise<void> {
    const context = this.state.dispatchContexts.get(ride.id);
    if (context !== undefined) await this.onOutcome({ type: 'ASSIGNED', ride, context });
  }

  private async emitFailure(
    ride: RideRequestStub,
    reason: 'EXPIRED' | 'NO_DRIVERS_AVAILABLE',
  ): Promise<void> {
    const context = this.state.dispatchContexts.get(ride.id);
    if (context !== undefined) await this.onOutcome({ type: 'FAILED', ride, context, reason });
  }
}
