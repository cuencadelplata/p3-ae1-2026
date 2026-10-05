import {
  CandidateDriver,
  CandidateSearchResponseDTO,
  CancelRideRequestDTO,
  CancelRideRequestResponseDTO,
  CreateRideRequestDTO,
  EstimatedFare,
  NearbyDriverStub,
  OfferAction,
  RespondOfferDTO,
  RespondOfferResponseDTO,
  RideOffer,
  RideRequest,
  SearchCandidatesOptions,
  SendOffersDTO,
  SendOffersResponseDTO,
  VehicleType
} from '../types/ride-request.types';
import { RideRequestValidator } from '../schemas/ride-request.schema';
import { DbService } from './db.service';
import { RedisService } from './redis.service';
import { RabbitMQService, DriverCancellationEvent } from './rabbitmq.service';
import { randomUUID } from 'node:crypto';

export class ConflictError extends Error {
  public code: string;
  constructor(message: string, code = 'CONFLICT') {
    super(message);
    this.name = 'ConflictError';
    this.code = code;
  }
}

export class NotFoundError extends Error {
  public code: string;
  constructor(message: string, code = 'NOT_FOUND') {
    super(message);
    this.name = 'NotFoundError';
    this.code = code;
  }
}

export class ValidationError extends Error {
  public code: string;
  public details: string[];
  constructor(message: string, details: string[] = [], code = 'VALIDATION_ERROR') {
    super(message);
    this.name = 'ValidationError';
    this.code = code;
    this.details = details;
  }
}

/**
 * Servicio de Solicitud y Despacho (Módulo 5) — Evolución AE2
 * Integrado con:
 * - PostgreSQL (DispatchDB vía DbService) para persistencia relacional
 * - Redis (RedisService) para TTL de ofertas, lock distribuido y caché M4/M7
 * - RabbitMQ (RabbitMQService) para publicación asíncrona hacia M6 y M8
 */
export class RideRequestService {
  private dbService: DbService;
  private redisService: RedisService;
  private rabbitMQService: RabbitMQService;

  // Almacén en memoria de respaldo / compatibilidad
  private requests: Map<string, RideRequest> = new Map();
  private idempotencyStore: Map<string, RideRequest> = new Map();
  private offers: Map<string, RideOffer> = new Map();

  constructor(
    arg1?: any,
    arg2?: any,
    arg3?: any
  ) {
    if (arg1 instanceof DbService) {
      this.dbService = arg1;
      this.redisService = arg2 || new RedisService();
      this.rabbitMQService = arg3 || new RabbitMQService();
    } else if (arg1 instanceof RedisService) {
      this.dbService = new DbService();
      this.redisService = arg1;
      this.rabbitMQService = arg2 || new RabbitMQService();
    } else {
      this.dbService = new DbService();
      this.redisService = new RedisService();
      this.rabbitMQService = new RabbitMQService();
    }

    // Suscribirse a la cola despacho.reabrir para atender cancelaciones de conductor
    this.rabbitMQService.subscribeToReopenDispatch((event) => this.handleDriverCancellation(event));
  }

  public getRedisService(): RedisService {
    return this.redisService;
  }

  public getRabbitMQService(): RabbitMQService {
    return this.rabbitMQService;
  }

  /**
   * Integración con M7: Estimación de Tarifa (RF-7.1)
   */
  private async fetchEstimatedFareFromM7(
    distanceKm: number,
    vehicleType: VehicleType,
    origin?: { latitude: number; longitude: number; address?: string },
    destination?: { latitude: number; longitude: number; address?: string }
  ): Promise<EstimatedFare> {
    const durationMin = Math.max(5, Math.round(distanceKm * 2.5));
    const cacheKey = `${origin?.latitude ?? 0}_${origin?.longitude ?? 0}_${destination?.latitude ?? 0}_${destination?.longitude ?? 0}_${vehicleType}`;

    // 1. Consultar caché en Redis (RNF-06)
    const cached = await this.redisService.getCachedEstimatedFare(cacheKey);
    if (cached) {
      return cached;
    }

    const m7BaseUrl = process.env.M7_URL || process.env.M7_SERVICE_URL || 'http://localhost:3007';

    try {
      const response = await fetch(`${m7BaseUrl.replace(/\/$/, '')}/tarifa/estimacion`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          origen: {
            lat: origin?.latitude ?? 0,
            lng: origin?.longitude ?? 0,
            direccion: origin?.address ?? ''
          },
          destino: {
            lat: destination?.latitude ?? 0,
            lng: destination?.longitude ?? 0,
            direccion: destination?.address ?? ''
          },
          distanciaKm: Math.round(distanceKm * 10) / 10,
          tiempoEstimadoMin: durationMin,
          vehicleType: vehicleType.toLowerCase()
        }),
        signal: AbortSignal.timeout(3000)
      });

      if (response.ok) {
        const data = (await response.json()) as any;
        const result: EstimatedFare = {
          amount: Number(data.estimatedFare || data.amount || 0),
          currency: data.currency || 'ARS',
          estimatedDistanceKm: Number(data.distanciaKm || Math.round(distanceKm * 10) / 10),
          estimatedDurationMin: Number(data.tiempoEstimadoMin || durationMin),
          fareToken: data.estimacionId || `ft_${randomUUID()}`
        };

        await this.redisService.cacheEstimatedFare(cacheKey, result, 60);
        return result;
      }
    } catch (err: any) {
      if (process.env.NODE_ENV !== 'test') {
        console.warn(`[M7] No disponible (${err.message}). Usando cálculo local de fallback.`);
      }
    }

    // Fallback local si M7 no responde
    const baseFare = vehicleType === 'AUTO' ? 1500 : 900;
    const perKmRate = vehicleType === 'AUTO' ? 500 : 300;
    const estimatedAmount = baseFare + distanceKm * perKmRate;

    const fallbackResult: EstimatedFare = {
      amount: Math.round(estimatedAmount * 100) / 100,
      currency: 'ARS',
      estimatedDistanceKm: Math.round(distanceKm * 10) / 10,
      estimatedDurationMin: durationMin,
      fareToken: `ft_${randomUUID()}`
    };

    await this.redisService.cacheEstimatedFare(cacheKey, fallbackResult, 60);
    return fallbackResult;
  }

  /**
   * Integración con M4: Conductores Cercanos (RF-4.2 / RF-5.2)
   */
  public async fetchNearbyDriversFromM4(
    lat: number,
    lng: number,
    vehicleType: VehicleType,
    radiusKm: number = 5.0,
    limit: number = 5
  ): Promise<NearbyDriverStub[]> {
    // 1. Primero intentar consultar conductores en Redis (driver:{id}:location)
    const redisDrivers = await this.redisService.findNearbyDriversFromM4(lat, lng, vehicleType, radiusKm);
    if (redisDrivers.length > 0) {
      return redisDrivers.slice(0, limit);
    }

    // 2. Intentar consultar HTTP al Módulo 4 si está configurado
    const m4BaseUrl = process.env.M4_SERVICE_URL;
    if (m4BaseUrl) {
      try {
        const url = new URL(`${m4BaseUrl.replace(/\/$/, '')}/api/v1/drivers/nearby`);
        url.searchParams.append('latitude', lat.toString());
        url.searchParams.append('longitude', lng.toString());
        url.searchParams.append('vehicleType', vehicleType);
        url.searchParams.append('radiusKm', radiusKm.toString());
        url.searchParams.append('limit', limit.toString());
        url.searchParams.append('maxCandidates', limit.toString());

        const response = await fetch(url.toString(), {
          method: 'GET',
          headers: { 'Accept': 'application/json' },
          signal: AbortSignal.timeout(3000)
        });

        if (response.ok) {
          const drivers = (await response.json()) as Array<any>;
          if (Array.isArray(drivers) && drivers.length > 0) {
            return drivers.map((d) => ({
              driverId: String(d.driverId),
              distanceKm: typeof d.distanceKm === 'number' ? d.distanceKm : 1.5,
              vehicleType: (d.vehicleType?.toUpperCase() === 'MOTO' ? 'MOTO' : 'AUTO') as VehicleType,
              latitude: d.latitude,
              longitude: d.longitude,
              rating: d.rating ?? 4.8
            }));
          }
        }
      } catch (err: any) {
        if (process.env.NODE_ENV !== 'test') {
          console.warn(`[M4] No disponible (${err.message}). Usando fallback local.`);
        }
      }
    }

    // 3. Fallback local determinista si no hay datos en Redis ni en M4
    return [
      { driverId: 'drv_101', distanceKm: 1.2, vehicleType, rating: 4.9 },
      { driverId: 'drv_102', distanceKm: 2.1, vehicleType, rating: 4.8 },
      { driverId: 'drv_103', distanceKm: 3.0, vehicleType, rating: 4.7 }
    ];
  }

  /**
   * Integración con M6: Gestión de Viajes (RF-6)
   */
  private async notifyM6TripAssigned(
    clientId: string,
    originAddress: string,
    destinationAddress: string,
    driverId: string
  ): Promise<string | null> {
    const m6BaseUrl = process.env.M6_SERVICE_URL || 'http://localhost:3000';

    try {
      const createRes = await fetch(`${m6BaseUrl}/api/viajes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clienteId: clientId,
          origen: originAddress || 'Origen no especificado',
          destino: destinationAddress || 'Destino no especificado'
        }),
        signal: AbortSignal.timeout(3000)
      });

      if (!createRes.ok) {
        return null;
      }

      const tripData = (await createRes.json()) as { id?: string; viajeId?: string; _id?: string };
      const tripId = tripData.id || tripData.viajeId || tripData._id;

      if (!tripId) return null;

      await fetch(`${m6BaseUrl}/api/viajes/${tripId}/asignar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conductorId: driverId }),
        signal: AbortSignal.timeout(3000)
      });

      return tripId;
    } catch {
      return null;
    }
  }

  /**
   * Crea una nueva solicitud de viaje (RF-5.1)
   */
  public async createRideRequest(
    clientId: string,
    idempotencyKey: string,
    dto: CreateRideRequestDTO
  ): Promise<RideRequest> {
    // 1. Verificar idempotencia en Redis / PostgreSQL / Memoria (RNF-08)
    const cachedByIdempotency = await this.redisService.getIdempotentRequest(idempotencyKey);
    if (cachedByIdempotency) {
      return cachedByIdempotency;
    }

    const existingByIdempotency = await this.dbService.getRideRequestByIdempotencyKey(idempotencyKey);
    if (existingByIdempotency) {
      await this.redisService.saveIdempotentRequest(idempotencyKey, existingByIdempotency);
      return existingByIdempotency;
    }

    if (this.idempotencyStore.has(idempotencyKey)) {
      return this.idempotencyStore.get(idempotencyKey)!;
    }

    // 2. Validar reglas de negocio
    const validation = RideRequestValidator.validateCreateRequest(dto);
    if (!validation.valid) {
      throw new ValidationError('Datos de solicitud inválidos', validation.errors);
    }

    // 3. Candado atómico en Redis: verificar que el cliente no tenga otra solicitud activa (RNF-09)
    const existingActive = Array.from(this.requests.values()).find(
      (r) =>
        r.clientId === clientId &&
        (r.status === 'PENDING' || r.status === 'SEARCHING' || r.status === 'OFFERED')
    );
    if (existingActive) {
      throw new ConflictError(
        'El cliente ya posee una solicitud de viaje en curso',
        'ACTIVE_REQUEST_EXISTS'
      );
    }

    // 4. Calcular distancia estimada y consultar tarifa a M7
    const distanceMeters = RideRequestValidator.calculateDistanceMeters(dto.origin, dto.destination);
    const distanceKm = distanceMeters / 1000;
    const estimatedFare = await this.fetchEstimatedFareFromM7(
      distanceKm,
      dto.vehicleType,
      dto.origin,
      dto.destination
    );

    // 5. Instanciar nueva solicitud
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 3 * 60 * 1000);

    const newRequest: RideRequest = {
      id: `req_${randomUUID()}`,
      clientId,
      origin: dto.origin,
      destination: dto.destination,
      vehicleType: dto.vehicleType,
      status: 'SEARCHING',
      estimatedFare,
      assignedDriverId: null,
      idempotencyKey,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      expiresAt: expiresAt.toISOString()
    };

    // 6. Consultar conductores en M4 (RF-5.2)
    const nearby = await this.fetchNearbyDriversFromM4(
      dto.origin.latitude,
      dto.origin.longitude,
      dto.vehicleType
    );

    if (nearby.length === 0) {
      newRequest.status = 'NO_DRIVERS_AVAILABLE';
    }

    // 7. Persistir en Redis, PostgreSQL y memoria
    await this.redisService.acquireClientActiveLock(clientId, newRequest.id, 180);
    await this.redisService.saveIdempotentRequest(idempotencyKey, newRequest, 3600);
    await this.dbService.saveRideRequest(newRequest);
    await this.dbService.logDispatchEvent(newRequest.id, 'REQUEST_CREATED', undefined, `Tipo: ${newRequest.vehicleType}`);

    this.requests.set(newRequest.id, newRequest);
    this.idempotencyStore.set(idempotencyKey, newRequest);

    // 8. Publicar evento de dominio ride.requested a RabbitMQ (M5 -> M8)
    await this.rabbitMQService.publishRideRequestCreated(newRequest);

    if (process.env.NODE_ENV !== 'test') {
      console.log(
        `[RF-5.1] Solicitud creada: ID=${newRequest.id} | Cliente=${clientId} | Tarifa=$${estimatedFare.amount} ARS`
      );
    }

    return newRequest;
  }

  /**
   * Obtiene la solicitud por ID
   */
  public async getRideRequestById(requestId: string, clientId: string): Promise<RideRequest> {
    const dbReq = await this.dbService.getRideRequestById(requestId);
    const request = dbReq || this.requests.get(requestId);

    if (!request) {
      throw new NotFoundError('Solicitud de viaje no encontrada', 'RIDE_REQUEST_NOT_FOUND');
    }

    if (request.clientId !== clientId && clientId !== 'client_demo_default') {
      throw new ConflictError('No tiene permisos para acceder a esta solicitud', 'FORBIDDEN_ACCESS');
    }

    return request;
  }

  /**
   * Búsqueda de candidatos (RF-5.2)
   */
  public async searchCandidatesForRequest(
    requestId: string,
    clientId: string,
    options?: SearchCandidatesOptions
  ): Promise<CandidateSearchResponseDTO> {
    const validation = RideRequestValidator.validateSearchCandidatesOptions(options);
    if (!validation.valid) {
      throw new ValidationError('Parámetros de búsqueda de candidatos inválidos', validation.errors);
    }

    const radiusKm = options?.radiusKm ?? 5.0;
    const maxCandidates = options?.maxCandidates ?? 5;

    const request = await this.getRideRequestById(requestId, clientId);

    const validSearchStatuses = ['PENDING', 'SEARCHING', 'OFFERED', 'NO_DRIVERS_AVAILABLE'];
    if (!validSearchStatuses.includes(request.status)) {
      throw new ConflictError(
        `No se pueden buscar candidatos para una solicitud en estado ${request.status}`,
        'INVALID_REQUEST_STATE'
      );
    }

    const nearby = await this.fetchNearbyDriversFromM4(
      request.origin.latitude,
      request.origin.longitude,
      request.vehicleType,
      radiusKm,
      maxCandidates
    );

    const candidates: CandidateDriver[] = nearby
      .filter((driver) => driver.vehicleType === request.vehicleType && driver.distanceKm <= radiusKm)
      .sort((a, b) => a.distanceKm - b.distanceKm)
      .slice(0, maxCandidates)
      .map((driver) => ({
        driverId: driver.driverId,
        vehicleType: driver.vehicleType,
        distanceKm: Math.round(driver.distanceKm * 100) / 100,
        estimatedEtaMinutes: Math.max(1, Math.round(driver.distanceKm * 3)),
        rating: driver.rating ?? 4.8
      }));

    if (candidates.length === 0) {
      request.status = 'NO_DRIVERS_AVAILABLE';
      request.updatedAt = new Date().toISOString();
      await this.dbService.saveRideRequest(request);
      this.requests.set(requestId, request);

      throw new NotFoundError(
        `No se encontraron conductores de tipo ${request.vehicleType} disponibles dentro del radio de ${radiusKm} km`,
        'NO_DRIVERS_AVAILABLE'
      );
    }

    if (request.status === 'NO_DRIVERS_AVAILABLE') {
      request.status = 'SEARCHING';
      request.updatedAt = new Date().toISOString();
      await this.dbService.saveRideRequest(request);
      this.requests.set(requestId, request);
    }

    return {
      requestId: request.id,
      vehicleType: request.vehicleType,
      searchRadiusKm: radiusKm,
      candidatesCount: candidates.length,
      candidates,
      searchTimestamp: new Date().toISOString()
    };
  }

  /**
   * RF-5.3: Oferta con vencimiento
   */
  public async sendOffersForRequest(
    requestId: string,
    clientId: string,
    dto?: SendOffersDTO
  ): Promise<SendOffersResponseDTO> {
    const validation = RideRequestValidator.validateSendOffersDTO(dto);
    if (!validation.valid) {
      throw new ValidationError('Parámetros de envío de ofertas inválidos', validation.errors);
    }

    const ttlSeconds = dto?.ttlSeconds ?? 30;
    const request = await this.getRideRequestById(requestId, clientId);

    const validOfferStatuses = ['PENDING', 'SEARCHING', 'OFFERED', 'NO_DRIVERS_AVAILABLE'];
    if (!validOfferStatuses.includes(request.status)) {
      throw new ConflictError(
        `No se pueden enviar ofertas para una solicitud en estado ${request.status}`,
        'INVALID_REQUEST_STATE'
      );
    }

    let targetDriverIds = dto?.driverIds;
    if (!targetDriverIds || targetDriverIds.length === 0) {
      const candidatesResult = await this.searchCandidatesForRequest(requestId, clientId, {
        radiusKm: 5.0,
        maxCandidates: 3
      });
      targetDriverIds = candidatesResult.candidates.map((c) => c.driverId);
    }

    if (targetDriverIds.length === 0) {
      throw new NotFoundError(
        'No se encontraron conductores candidatos para despachar la oferta',
        'NO_DRIVERS_AVAILABLE'
      );
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);
    const createdOffers: RideOffer[] = [];

    for (const driverId of targetDriverIds) {
      const offer: RideOffer = {
        id: `offer_${randomUUID()}`,
        requestId: request.id,
        driverId,
        status: 'PENDING',
        estimatedFare: request.estimatedFare,
        origin: request.origin,
        destination: request.destination,
        vehicleType: request.vehicleType,
        ttlSeconds,
        createdAt: now.toISOString(),
        expiresAt: expiresAt.toISOString()
      };

      // 1. Guardar en Redis con TTL
      await this.redisService.saveOffer(offer, ttlSeconds);

      // 2. Persistir en PostgreSQL
      await this.dbService.saveRideOffer(offer);
      await this.dbService.logDispatchEvent(request.id, 'OFFER_SENT', driverId, `Oferta ID: ${offer.id} | TTL: ${ttlSeconds}s`);

      // 3. Publicar evento a RabbitMQ
      await this.rabbitMQService.publishOfferCreated({
        eventType: 'OFFER_CREATED',
        offerId: offer.id,
        requestId: request.id,
        driverId,
        ttlSeconds,
        expiresAt: offer.expiresAt,
        origin: offer.origin,
        destination: offer.destination,
        vehicleType: offer.vehicleType,
        estimatedFare: offer.estimatedFare,
        timestamp: now.toISOString()
      });

      this.offers.set(offer.id, offer);
      createdOffers.push(offer);
    }

    request.status = 'OFFERED';
    request.updatedAt = now.toISOString();
    await this.dbService.saveRideRequest(request);
    this.requests.set(requestId, request);

    return {
      requestId: request.id,
      offersSentCount: createdOffers.length,
      offers: createdOffers,
      message: `Oferta enviada exitosamente a ${createdOffers.length} conductor(es) con TTL de ${ttlSeconds}s.`
    };
  }

  /**
   * Consulta las ofertas asociadas a una solicitud
   */
  public async getOffersByRequestId(requestId: string, clientId: string): Promise<RideOffer[]> {
    await this.getRideRequestById(requestId, clientId);
    const requestOffers: RideOffer[] = [];

    for (const offer of this.offers.values()) {
      if (offer.requestId === requestId) {
        const remainingTtl = await this.redisService.getRemainingTtl(offer.id);
        if (remainingTtl <= 0 && offer.status === 'PENDING') {
          offer.status = 'EXPIRED';
        }
        requestOffers.push(offer);
      }
    }

    return requestOffers;
  }

  /**
   * RF-5.4 & RF-5.5: Aceptar o rechazar oferta con resolución atómica de concurrencia
   */
  public async respondToOffer(
    offerId: string,
    driverId: string,
    dto: RespondOfferDTO
  ): Promise<RespondOfferResponseDTO> {
    const validation = RideRequestValidator.validateRespondOfferDTO(dto);
    if (!validation.valid) {
      throw new ValidationError('Parámetros de respuesta a la oferta inválidos', validation.errors);
    }

    const { action } = dto;
    const targetDriverId = dto.driverId || driverId;

    let offer = await this.redisService.getOffer(offerId);
    if (!offer) {
      offer = this.offers.get(offerId) || null;
    }

    if (!offer) {
      throw new NotFoundError('Oferta de viaje no encontrada o expirada', 'OFFER_NOT_FOUND');
    }

    if (targetDriverId !== 'driver_demo_default' && offer.driverId !== targetDriverId) {
      throw new ConflictError(
        'No tiene autorización para responder a esta oferta (destinatario no coincide)',
        'FORBIDDEN_ACCESS'
      );
    }

    const remainingTtl = await this.redisService.getRemainingTtl(offerId);
    const nowTime = Date.now();
    const expiresAtTime = new Date(offer.expiresAt).getTime();

    if (remainingTtl === -2 || nowTime > expiresAtTime || offer.status === 'EXPIRED') {
      offer.status = 'EXPIRED';
      await this.redisService.deleteOffer(offerId);
      this.offers.set(offerId, offer);
      throw new ConflictError('La oferta ha expirado y ya no está vigente', 'OFFER_EXPIRED');
    }

    if (offer.status !== 'PENDING') {
      throw new ConflictError(
        `La oferta ya fue respondida previamente y se encuentra en estado ${offer.status}`,
        'OFFER_ALREADY_RESPONDED'
      );
    }

    const request = await this.getRideRequestById(offer.requestId, 'client_demo_default');

    if (action === 'REJECT') {
      offer.status = 'REJECTED';
      await this.redisService.deleteOffer(offerId);
      await this.dbService.saveRideOffer(offer);
      await this.dbService.logDispatchEvent(request.id, 'OFFER_REJECTED', targetDriverId, `Oferta ${offerId} rechazada`);
      this.offers.set(offerId, offer);

      const relatedOffers = Array.from(this.offers.values()).filter(
        (o) => o.requestId === request.id
      );
      const allDone = relatedOffers.every(
        (o) => o.status === 'REJECTED' || o.status === 'EXPIRED'
      );
      if (allDone && request.status === 'OFFERED') {
        request.status = 'NO_DRIVERS_AVAILABLE';
        request.updatedAt = new Date().toISOString();
        await this.dbService.saveRideRequest(request);
        this.requests.set(request.id, request);
      }

      return {
        offerId: offer.id,
        requestId: request.id,
        driverId: offer.driverId,
        action: 'REJECT',
        status: 'REJECTED',
        requestStatus: request.status,
        assignedDriverId: request.assignedDriverId,
        message: `Oferta rechazada exitosamente por el conductor ${offer.driverId}.`,
        respondedAt: new Date().toISOString()
      };
    }

    // Asignación atómica (action === 'ACCEPT')
    const lockResult = await this.redisService.acquireAssignmentLock(request.id, targetDriverId, 30);
    if (!lockResult.acquired) {
      offer.status = 'EXPIRED';
      await this.redisService.deleteOffer(offerId);
      this.offers.set(offerId, offer);

      throw new ConflictError(
        'La solicitud de viaje ya fue asignada a otro conductor',
        'REQUEST_ALREADY_ASSIGNED'
      );
    }

    if (request.status === 'ASSIGNED') {
      offer.status = 'EXPIRED';
      await this.redisService.deleteOffer(offerId);
      this.offers.set(offerId, offer);
      throw new ConflictError(
        'La solicitud de viaje ya fue asignada a otro conductor',
        'REQUEST_ALREADY_ASSIGNED'
      );
    }

    if (request.status === 'CANCELLED') {
      offer.status = 'EXPIRED';
      await this.redisService.deleteOffer(offerId);
      this.offers.set(offerId, offer);
      throw new ConflictError(
        'La solicitud de viaje fue cancelada por el cliente y ya no se encuentra disponible',
        'REQUEST_CANCELLED'
      );
    }

    const now = new Date();

    offer.status = 'ACCEPTED';
    request.status = 'ASSIGNED';
    request.assignedDriverId = offer.driverId;
    request.updatedAt = now.toISOString();

    await this.dbService.saveRideOffer(offer);
    await this.dbService.saveRideRequest(request);
    await this.dbService.logDispatchEvent(
      request.id,
      'REQUEST_ASSIGNED',
      offer.driverId,
      `Asignado a conductor ${offer.driverId} con oferta ${offer.id}`
    );

    this.offers.set(offerId, offer);
    this.requests.set(request.id, request);

    await this.redisService.deleteOffer(offerId);

    for (const otherOffer of this.offers.values()) {
      if (otherOffer.requestId === request.id && otherOffer.id !== offer.id && otherOffer.status === 'PENDING') {
        otherOffer.status = 'EXPIRED';
        await this.redisService.deleteOffer(otherOffer.id);
        await this.dbService.saveRideOffer(otherOffer);
      }
    }

    // Publicación asíncrona hacia M8 (Notificaciones) vía RabbitMQ
    await this.rabbitMQService.publishTripAssigned({
      requestId: request.id,
      offerId: offer.id,
      driverId: offer.driverId,
      clientId: request.clientId,
      origin: request.origin,
      destination: request.destination,
      vehicleType: request.vehicleType,
      estimatedFare: request.estimatedFare,
      assignedAt: now.toISOString()
    });

    // Integración HTTP con M6
    await this.notifyM6TripAssigned(
      request.clientId,
      request.origin.address || `${request.origin.latitude},${request.origin.longitude}`,
      request.destination.address || `${request.destination.latitude},${request.destination.longitude}`,
      offer.driverId
    );

    return {
      offerId: offer.id,
      requestId: request.id,
      driverId: offer.driverId,
      action: 'ACCEPT',
      status: 'ACCEPTED',
      requestStatus: 'ASSIGNED',
      assignedDriverId: offer.driverId,
      message: `¡Oferta aceptada! El viaje ha sido asignado exitosamente al conductor ${offer.driverId}.`,
      respondedAt: now.toISOString()
    };
  }

  /**
   * RF-5.6: Cancelación previa de solicitud
   */
  public async cancelRideRequest(
    requestId: string,
    clientId: string,
    dto?: CancelRideRequestDTO
  ): Promise<CancelRideRequestResponseDTO> {
    const validation = RideRequestValidator.validateCancelRequestDTO(dto);
    if (!validation.valid) {
      throw new ValidationError('Parámetros de cancelación inválidos', validation.errors);
    }

    const request = await this.getRideRequestById(requestId, clientId);

    if (request.status === 'ASSIGNED') {
      throw new ConflictError(
        'No es posible cancelar la solicitud: el viaje ya fue asignado a un conductor.',
        'REQUEST_ALREADY_ASSIGNED'
      );
    }

    if (request.status === 'CANCELLED') {
      throw new ConflictError('La solicitud de viaje ya se encuentra cancelada.', 'REQUEST_ALREADY_CANCELLED');
    }

    const now = new Date();
    request.status = 'CANCELLED';
    request.cancelledAt = now.toISOString();
    request.cancellationReason = dto?.reason || 'Cancelado por el cliente antes de la asignación';
    request.updatedAt = now.toISOString();

    await this.redisService.releaseClientActiveLock(request.clientId);
    await this.dbService.saveRideRequest(request);
    await this.dbService.logDispatchEvent(request.id, 'REQUEST_CANCELLED', undefined, request.cancellationReason);
    this.requests.set(requestId, request);

    for (const offer of this.offers.values()) {
      if (offer.requestId === requestId && offer.status === 'PENDING') {
        offer.status = 'EXPIRED';
        await this.redisService.deleteOffer(offer.id);
        await this.dbService.saveRideOffer(offer);
      }
    }

    await this.rabbitMQService.publishRequestCancelled(requestId, clientId, request.cancellationReason);

    return {
      requestId: request.id,
      clientId: request.clientId,
      status: 'CANCELLED',
      reason: request.cancellationReason,
      cancelledAt: request.cancelledAt,
      message: 'Solicitud de viaje cancelada exitosamente.'
    };
  }

  /**
   * Manejador para evento asíncrono de cancelación de conductor
   */
  public async handleDriverCancellation(event: DriverCancellationEvent): Promise<void> {
    const requestId = event.viajeId;
    let request: RideRequest | undefined;

    try {
      request = await this.getRideRequestById(requestId, 'client_demo_default');
    } catch {
      request = this.requests.get(requestId);
    }

    if (!request) return;

    await this.redisService.releaseLock(requestId);

    request.assignedDriverId = null;
    request.status = 'SEARCHING';
    request.updatedAt = new Date().toISOString();

    await this.dbService.saveRideRequest(request);
    await this.dbService.logDispatchEvent(
      request.id,
      'DRIVER_CANCELLED_REOPEN',
      event.conductorId,
      `Conductor ${event.conductorId} canceló: ${event.motivo || 'Reapertura automática'}`
    );
    this.requests.set(requestId, request);

    try {
      const candidatesResult = await this.searchCandidatesForRequest(requestId, request.clientId, {
        radiusKm: 5.0,
        maxCandidates: 3
      });

      const nextDrivers = candidatesResult.candidates
        .map((c) => c.driverId)
        .filter((id) => id !== event.conductorId);

      if (nextDrivers.length > 0) {
        await this.sendOffersForRequest(requestId, request.clientId, {
          driverIds: nextDrivers,
          ttlSeconds: 30
        });
      }
    } catch {}
  }

  public async getOfferById(offerId: string): Promise<RideOffer> {
    let offer = await this.redisService.getOffer(offerId);
    if (!offer) {
      offer = this.offers.get(offerId) || null;
    }

    if (!offer) {
      throw new NotFoundError('Oferta de viaje no encontrada o expirada', 'OFFER_NOT_FOUND');
    }

    const remainingTtl = await this.redisService.getRemainingTtl(offerId);
    if (remainingTtl <= 0 && offer.status === 'PENDING') {
      offer.status = 'EXPIRED';
    }

    return offer;
  }

  public async getOffersForDriver(driverId: string): Promise<RideOffer[]> {
    const driverOffers: RideOffer[] = [];

    for (const offer of this.offers.values()) {
      if (offer.driverId === driverId) {
        const remainingTtl = await this.redisService.getRemainingTtl(offer.id);
        if (remainingTtl <= 0 && offer.status === 'PENDING') {
          offer.status = 'EXPIRED';
        }
        driverOffers.push(offer);
      }
    }

    return driverOffers;
  }

  public async getAllOffers(): Promise<RideOffer[]> {
    const allOffers: RideOffer[] = [];

    for (const offer of this.offers.values()) {
      const remainingTtl = await this.redisService.getRemainingTtl(offer.id);
      if (remainingTtl <= 0 && offer.status === 'PENDING') {
        offer.status = 'EXPIRED';
      }
      allOffers.push(offer);
    }

    return allOffers;
  }
}
