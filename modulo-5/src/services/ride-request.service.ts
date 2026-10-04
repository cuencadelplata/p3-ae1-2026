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
import { RabbitMqService } from './rabbitmq.service';
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
 * - Redis (RedisService) para TTL de ofertas y bloqueo distribuido atómico (RF-5.4 y RF-5.5)
 * - RabbitMQ (RabbitMqService) para publicación asíncrona hacia M6 y M8
 */
export class RideRequestService {
  private dbService: DbService;
  private redisService: RedisService;
  private rabbitMqService: RabbitMqService;

  // Almacén en memoria de respaldo / compatibilidad
  private requests: Map<string, RideRequest> = new Map();
  private idempotencyStore: Map<string, RideRequest> = new Map();
  private offers: Map<string, RideOffer> = new Map();

  constructor(
    dbService?: DbService,
    redisService?: RedisService,
    rabbitMqService?: RabbitMqService
  ) {
    this.dbService = dbService || new DbService();
    this.redisService = redisService || new RedisService();
    this.rabbitMqService = rabbitMqService || new RabbitMqService();
  }

  /**
   * Stub de integración con M7: Estimación de Tarifa (RF-7.1)
   */
  private async fetchEstimatedFareFromM7(
    distanceKm: number,
    vehicleType: VehicleType
  ): Promise<EstimatedFare> {
    const baseFare = vehicleType === 'AUTO' ? 1500 : 900;
    const perKmRate = vehicleType === 'AUTO' ? 500 : 300;
    const estimatedAmount = baseFare + distanceKm * perKmRate;
    const durationMin = Math.max(5, Math.round(distanceKm * 2.5));

    return {
      amount: Math.round(estimatedAmount * 100) / 100,
      currency: 'ARS',
      estimatedDistanceKm: Math.round(distanceKm * 10) / 10,
      estimatedDurationMin: durationMin,
      fareToken: `ft_${randomUUID()}`
    };
  }

  /**
   * Stub de integración con M4: Conductores Cercanos (RF-4.2)
   */
  private async fetchNearbyDriversFromM4(
    _lat: number,
    _lng: number,
    vehicleType: VehicleType
  ): Promise<NearbyDriverStub[]> {
    return [
      { driverId: 'drv_101', distanceKm: 1.2, vehicleType },
      { driverId: 'drv_102', distanceKm: 2.1, vehicleType },
      { driverId: 'drv_103', distanceKm: 3.0, vehicleType }
    ];
  }

  /**
   * Crea una nueva solicitud de viaje (RF-5.1)
   */
  public async createRideRequest(
    clientId: string,
    idempotencyKey: string,
    dto: CreateRideRequestDTO
  ): Promise<RideRequest> {
    // 1. Verificar idempotencia (RNF-08)
    const existingByIdempotency = await this.dbService.getRideRequestByIdempotencyKey(idempotencyKey);
    if (existingByIdempotency) {
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

    // 3. Verificar que el cliente no tenga otra solicitud activa
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
    const estimatedFare = await this.fetchEstimatedFareFromM7(distanceKm, dto.vehicleType);

    // 4. Instanciar nueva solicitud
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 3 * 60 * 1000); // 3 minutos TTL de búsqueda

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

    // 5. Consultar conductores en M4 (RF-5.2)
    const nearby = await this.fetchNearbyDriversFromM4(
      dto.origin.latitude,
      dto.origin.longitude,
      dto.vehicleType
    );

    if (nearby.length === 0) {
      newRequest.status = 'NO_DRIVERS_AVAILABLE';
    }

    // 6. Persistir en PostgreSQL y Almacenes
    await this.dbService.saveRideRequest(newRequest);
    await this.dbService.logDispatchEvent(newRequest.id, 'REQUEST_CREATED', undefined, `Tipo: ${newRequest.vehicleType}`);

    this.requests.set(newRequest.id, newRequest);
    this.idempotencyStore.set(idempotencyKey, newRequest);

    console.log(
      `[RF-5.1] Solicitud de viaje creada: ID=${newRequest.id} | Cliente=${clientId} | Vehículo=${newRequest.vehicleType} | Tarifa=$${estimatedFare.amount} ARS`
    );

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

    // Control de acceso multi-tenant
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
      request.vehicleType
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
   * Despacha ofertas persistiendo en Redis (con TTL) y PostgreSQL, y publicando a RabbitMQ.
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

      // 1. Guardar en Redis con TTL (dispatch:offer:{offerId})
      await this.redisService.saveOffer(offer, ttlSeconds);

      // 2. Persistir en PostgreSQL
      await this.dbService.saveRideOffer(offer);
      await this.dbService.logDispatchEvent(request.id, 'OFFER_SENT', driverId, `Oferta ID: ${offer.id} | TTL: ${ttlSeconds}s`);

      // 3. Publicar evento a RabbitMQ en cola dispatch.offers
      await this.rabbitMqService.publishToQueue('dispatch.offers', {
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

    console.log(
      `[RF-5.3] Ofertas despachadas: Solicitud=${request.id} | Cantidad=${createdOffers.length} | TTL=${ttlSeconds}s en Redis y Postgres`
    );

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
        // Verificar TTL en Redis
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
    // 1. Validar DTO
    const validation = RideRequestValidator.validateRespondOfferDTO(dto);
    if (!validation.valid) {
      throw new ValidationError('Parámetros de respuesta a la oferta inválidos', validation.errors);
    }

    const { action } = dto;
    const targetDriverId = dto.driverId || driverId;

    // 2. Obtener oferta desde Redis (RF-5.4: Estado efímero y vigencia TTL)
    let offer = await this.redisService.getOffer(offerId);
    if (!offer) {
      offer = this.offers.get(offerId) || null;
    }

    if (!offer) {
      throw new NotFoundError('Oferta de viaje no encontrada o expirada', 'OFFER_NOT_FOUND');
    }

    // 3. Validar destinatario de la oferta
    if (targetDriverId !== 'driver_demo_default' && offer.driverId !== targetDriverId) {
      throw new ConflictError(
        'No tiene autorización para responder a esta oferta (destinatario no coincide)',
        'FORBIDDEN_ACCESS'
      );
    }

    // 4. Verificar vigencia por tiempo (TTL) en Redis
    const remainingTtl = await this.redisService.getRemainingTtl(offerId);
    const nowTime = Date.now();
    const expiresAtTime = new Date(offer.expiresAt).getTime();

    if (remainingTtl === -2 || nowTime > expiresAtTime || offer.status === 'EXPIRED') {
      offer.status = 'EXPIRED';
      await this.redisService.deleteOffer(offerId);
      this.offers.set(offerId, offer);
      throw new ConflictError('La oferta ha expirado y ya no está vigente', 'OFFER_EXPIRED');
    }

    // 5. Verificar que no haya sido respondida previamente
    if (offer.status !== 'PENDING') {
      throw new ConflictError(
        `La oferta ya fue respondida previamente y se encuentra en estado ${offer.status}`,
        'OFFER_ALREADY_RESPONDED'
      );
    }

    // 6. Obtener la solicitud asociada desde la BD
    const request = await this.getRideRequestById(offer.requestId, 'client_demo_default');

    // Manejo de rechazo (REJECT)
    if (action === 'REJECT') {
      offer.status = 'REJECTED';
      await this.redisService.deleteOffer(offerId);
      await this.dbService.saveRideOffer(offer);
      await this.dbService.logDispatchEvent(request.id, 'OFFER_REJECTED', targetDriverId, `Oferta ${offerId} rechazada`);
      this.offers.set(offerId, offer);

      // Si todas las ofertas para esta solicitud fueron rechazadas o expiraron
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

    // =========================================================================
    // RF-5.5: Asignación Única y Resolución Atómica de Concurrencia (action === 'ACCEPT')
    // =========================================================================

    // 1. Lock Distribuido Atómico en Redis (SET NX EX)
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

    // 2. Validar que la solicitud siga disponible
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

    // 3. Asignar el viaje y actualizar persistencia en PostgreSQL
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

    // 4. Borrar la oferta ganadora de Redis e invalidar las ofertas perdedoras
    await this.redisService.deleteOffer(offerId);

    for (const otherOffer of this.offers.values()) {
      if (otherOffer.requestId === request.id && otherOffer.id !== offer.id && otherOffer.status === 'PENDING') {
        otherOffer.status = 'EXPIRED';
        await this.redisService.deleteOffer(otherOffer.id);
        await this.dbService.saveRideOffer(otherOffer);
      }
    }

    // 5. Publicación Asíncrona del Evento hacia M6 (Viajes) y M8 (Notificaciones) vía RabbitMQ
    await this.rabbitMqService.publishTripAssigned({
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

    console.log(
      `[RF-5.4 / RF-5.5] Oferta ${offer.id} ACEPTADA por conductor ${offer.driverId}. Solicitud ${request.id} ASIGNADA exclusivamente. Evento publicado a RabbitMQ (dispatch.assigned).`
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

    await this.dbService.saveRideRequest(request);
    await this.dbService.logDispatchEvent(request.id, 'REQUEST_CANCELLED', undefined, request.cancellationReason);
    this.requests.set(requestId, request);

    // Limpiar ofertas en Redis y RabbitMQ
    for (const offer of this.offers.values()) {
      if (offer.requestId === requestId && offer.status === 'PENDING') {
        offer.status = 'EXPIRED';
        await this.redisService.deleteOffer(offer.id);
        await this.dbService.saveRideOffer(offer);
      }
    }

    await this.rabbitMqService.publishRequestCancelled(requestId, clientId, request.cancellationReason);

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
   * Obtiene una oferta por ID con cálculo dinámico de TTL
   */
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

  /**
   * Obtiene todas las ofertas asignadas a un conductor específico
   */
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

  /**
   * Obtiene todas las ofertas emitidas en el sistema
   */
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

