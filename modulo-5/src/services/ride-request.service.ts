import {
  CandidateDriver,
  CandidateSearchResponseDTO,
  CancelRideRequestDTO,
  CancelRideRequestResponseDTO,
  CreateRideRequestDTO,
  DispatchAuditEvent,
  DriverCancellationEvent,
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
import { RedisService } from './redis.service';
import { RabbitMQService } from './rabbitmq.service';
import { M4ClientService } from './m4-client.service';
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
 * Servicio de Solicitud y Despacho (Módulo 5) — AE2
 * Gestiona ciclo de vida de solicitudes, candidatos, ofertas con TTL, concurrencia, Redis y RabbitMQ.
 */
export class RideRequestService {
  private requests: Map<string, RideRequest> = new Map();
  private idempotencyStore: Map<string, RideRequest> = new Map();
  private offers: Map<string, RideOffer> = new Map();
  private auditEvents: DispatchAuditEvent[] = [];

  private redisService: RedisService;
  private rabbitmqService: RabbitMQService;
  private m4ClientService: M4ClientService;

  constructor(
    redisService?: RedisService,
    rabbitmqService?: RabbitMQService,
    m4ClientService?: M4ClientService
  ) {
    this.redisService = redisService || new RedisService();
    this.rabbitmqService = rabbitmqService || new RabbitMQService();
    this.m4ClientService = m4ClientService || new M4ClientService();

    // Suscribirse a la cola despacho.reabrir para atender cancelaciones de conductor (integración con módulo de cancelaciones)
    this.rabbitmqService.subscribeToReopenDispatch((event) => this.handleDriverCancellation(event));
  }

  public getRedisService(): RedisService {
    return this.redisService;
  }

  public getRabbitMQService(): RabbitMQService {
    return this.rabbitmqService;
  }

  public getM4ClientService(): M4ClientService {
    return this.m4ClientService;
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
   * Integración con M4: Conductores Cercanos (RF-4.2 / RF-5.2)
   * Consulta las ubicaciones y disponibilidad de conductores vía HTTP GET /api/v1/drivers/nearby
   */
  public async fetchNearbyDriversFromM4(
    lat: number,
    lng: number,
    vehicleType: VehicleType,
    radiusKm: number = 5.0,
    maxCandidates: number = 10
  ): Promise<NearbyDriverStub[]> {
    return this.m4ClientService.findNearbyDrivers(lat, lng, vehicleType, radiusKm, maxCandidates);
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
    if (this.idempotencyStore.has(idempotencyKey)) {
      return this.idempotencyStore.get(idempotencyKey)!;
    }

    // 2. Validar reglas de negocio
    const validation = RideRequestValidator.validateCreateRequest(dto);
    if (!validation.valid) {
      throw new ValidationError('Datos de solicitud inválidos', validation.errors);
    }

    // Limpieza de solicitudes expiradas
    const nowTime = Date.now();
    for (const r of this.requests.values()) {
      if (
        (r.status === 'PENDING' || r.status === 'SEARCHING' || r.status === 'OFFERED') &&
        new Date(r.expiresAt).getTime() < nowTime
      ) {
        r.status = 'EXPIRED';
        r.updatedAt = new Date().toISOString();
      }
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

    // 5. Instanciar nueva solicitud
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 3 * 60 * 1000); // 3 minutos TTL de búsqueda

    const newRequest: RideRequest = {
      id: randomUUID(),
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

    // 7. Persistir en almacenamiento e historial inmutable (RNF-04)
    this.requests.set(newRequest.id, newRequest);
    this.idempotencyStore.set(idempotencyKey, newRequest);

    this.auditEvents.push({
      eventId: `evt_${randomUUID()}`,
      requestId: newRequest.id,
      eventType: 'CREATED',
      actorId: clientId,
      actorType: 'CLIENT',
      payload: { vehicleType: newRequest.vehicleType, estimatedFare },
      timestamp: now.toISOString()
    });

    console.log(
      `[RF-5.1] Solicitud de viaje creada: ID=${newRequest.id} | Cliente=${clientId} | Vehículo=${newRequest.vehicleType} | Tarifa=$${estimatedFare.amount} ARS | Origen="${dto.origin.address}" ➔ Destino="${dto.destination.address}"`
    );

    return newRequest;
  }

  /**
   * Obtiene la solicitud por ID
   */
  public async getRideRequestById(requestId: string, clientId: string): Promise<RideRequest> {
    const request = this.requests.get(requestId);
    if (!request) {
      throw new NotFoundError('Solicitud de viaje no encontrada', 'RIDE_REQUEST_NOT_FOUND');
    }

    if (request.clientId !== clientId) {
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
      this.requests.set(requestId, request);

      throw new NotFoundError(
        `No se encontraron conductores de tipo ${request.vehicleType} disponibles dentro del radio de ${radiusKm} km`,
        'NO_DRIVERS_AVAILABLE'
      );
    }

    if (request.status === 'NO_DRIVERS_AVAILABLE') {
      request.status = 'SEARCHING';
      request.updatedAt = new Date().toISOString();
      this.requests.set(requestId, request);
    }

    console.log(
      `[RF-5.2] Búsqueda de candidatos para solicitud ${requestId}: Radio=${radiusKm}km | Tipo=${request.vehicleType} | Encontrados=${candidates.length}`
    );

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
   * RF-5.3: Oferta con vencimiento (Redis + RabbitMQ)
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
        id: `off_${randomUUID()}`,
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

      this.offers.set(offer.id, offer);
      createdOffers.push(offer);

      // Persistir oferta en Redis con TTL (RNF-06)
      await this.redisService.saveOffer(offer, ttlSeconds);

      // Publicar evento en RabbitMQ (RNF-07)
      await this.rabbitmqService.publishOfferCreated({
        eventType: 'OFFER_CREATED',
        offerId: offer.id,
        requestId: request.id,
        driverId: offer.driverId,
        ttlSeconds,
        expiresAt: offer.expiresAt,
        origin: offer.origin,
        destination: offer.destination,
        vehicleType: offer.vehicleType,
        estimatedFare: offer.estimatedFare,
        timestamp: now.toISOString()
      });
    }

    request.status = 'OFFERED';
    request.updatedAt = now.toISOString();
    this.requests.set(requestId, request);

    this.auditEvents.push({
      eventId: `evt_${randomUUID()}`,
      requestId: request.id,
      eventType: 'OFFERED',
      actorId: clientId,
      actorType: 'CLIENT',
      payload: { offersCount: createdOffers.length, ttlSeconds },
      timestamp: now.toISOString()
    });

    console.log(
      `[RF-5.3] Ofertas despachadas: Solicitud=${request.id} | Cantidad=${createdOffers.length} | TTL=${ttlSeconds}s`
    );

    return {
      requestId: request.id,
      offersSentCount: createdOffers.length,
      offers: createdOffers,
      message: `Oferta enviada exitosamente a ${createdOffers.length} conductor(es) con TTL de ${ttlSeconds}s.`
    };
  }

  /**
   * Consulta las ofertas emitidas para una solicitud
   */
  public async getOffersByRequestId(requestId: string, clientId: string): Promise<RideOffer[]> {
    await this.getRideRequestById(requestId, clientId);

    const now = new Date().getTime();
    return Array.from(this.offers.values())
      .filter((offer) => offer.requestId === requestId)
      .map((offer) => {
        if (offer.status === 'PENDING' && new Date(offer.expiresAt).getTime() < now) {
          offer.status = 'EXPIRED';
        }
        return offer;
      });
  }

  /**
   * RF-5.4 / RF-5.5: Aceptar o rechazar oferta con resolución de concurrencia (Redis locks)
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

    let offer = this.offers.get(offerId);
    if (!offer) {
      offer = (await this.redisService.getOffer(offerId)) || undefined;
    }

    if (!offer) {
      throw new NotFoundError('Oferta de viaje no encontrada', 'OFFER_NOT_FOUND');
    }

    if (targetDriverId !== 'driver_demo_default' && offer.driverId !== targetDriverId) {
      throw new ConflictError(
        'No tiene autorización para responder a esta oferta (destinatario no coincide)',
        'FORBIDDEN_ACCESS'
      );
    }

    // 4. Verificar si la solicitud fue cancelada por el cliente antes de evaluar expiración genérica
    const request = this.requests.get(offer.requestId);
    const isCancelledInRedis = await this.redisService.isRequestCancelled(offer.requestId);
    if (request?.status === 'CANCELLED' || isCancelledInRedis) {
      offer.status = 'EXPIRED';
      this.offers.set(offerId, offer);
      await this.redisService.deleteOffer(offerId);
      throw new ConflictError(
        'La solicitud de viaje fue cancelada por el cliente y ya no se encuentra disponible',
        'REQUEST_CANCELLED'
      );
    }

    // 5. Verificar vigencia por tiempo (TTL)
    const now = new Date();
    const nowTime = now.getTime();
    const expiresAtTime = new Date(offer.expiresAt).getTime();

    if (nowTime > expiresAtTime || offer.status === 'EXPIRED') {
      offer.status = 'EXPIRED';
      this.offers.set(offerId, offer);
      await this.redisService.deleteOffer(offerId);
      throw new ConflictError('La oferta ha expirado y ya no está vigente', 'OFFER_EXPIRED');
    }

    if (offer.status !== 'PENDING') {
      throw new ConflictError(
        `La oferta ya fue respondida previamente y se encuentra en estado ${offer.status}`,
        'OFFER_ALREADY_RESPONDED'
      );
    }

    // Adquirir lock distribuido para evitar condición de carrera (Cancelación vs Aceptación - RNF-09)
    const lockKey = `request:${offer.requestId}`;
    let acquired = await this.redisService.acquireLock(lockKey, 3000);
    let attempts = 0;
    while (!acquired && attempts < 20) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      const current = this.requests.get(offer.requestId);
      if (current && current.status === 'ASSIGNED') {
        throw new ConflictError(
          'La solicitud de viaje ya fue asignada a otro conductor',
          'REQUEST_ALREADY_ASSIGNED'
        );
      }
      acquired = await this.redisService.acquireLock(lockKey, 3000);
      attempts++;
    }

    if (!acquired) {
      const current = this.requests.get(offer.requestId);
      if (current && current.status === 'ASSIGNED') {
        throw new ConflictError(
          'La solicitud de viaje ya fue asignada a otro conductor',
          'REQUEST_ALREADY_ASSIGNED'
        );
      }
      throw new ConflictError(
        'La solicitud de viaje ya fue asignada a otro conductor',
        'REQUEST_ALREADY_ASSIGNED'
      );
    }

    try {
      const request = this.requests.get(offer.requestId);
      if (!request) {
        throw new NotFoundError('Solicitud de viaje asociada no encontrada', 'RIDE_REQUEST_NOT_FOUND');
      }

      // Verificar si la solicitud fue cancelada por el cliente (RF-5.6)
      const isCancelledInRedis = await this.redisService.isRequestCancelled(request.id);
      if (request.status === 'CANCELLED' || isCancelledInRedis) {
        offer.status = 'EXPIRED';
        this.offers.set(offerId, offer);
        await this.redisService.deleteOffer(offerId);
        throw new ConflictError(
          'La solicitud de viaje fue cancelada por el cliente y ya no se encuentra disponible',
          'REQUEST_CANCELLED'
        );
      }

      if (action === 'REJECT') {
        offer.status = 'REJECTED';
        this.offers.set(offerId, offer);
        await this.redisService.deleteOffer(offerId);

        const relatedOffers = Array.from(this.offers.values()).filter(
          (o) => o.requestId === request.id
        );
        const allDone = relatedOffers.every(
          (o) => o.status === 'REJECTED' || o.status === 'EXPIRED'
        );
        if (allDone && request.status === 'OFFERED') {
          request.status = 'NO_DRIVERS_AVAILABLE';
          request.updatedAt = now.toISOString();
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
          respondedAt: now.toISOString()
        };
      }

      // Acción: ACCEPT (RF-5.5)
      if (request.status === 'ASSIGNED') {
        offer.status = 'EXPIRED';
        this.offers.set(offerId, offer);
        await this.redisService.deleteOffer(offerId);
        throw new ConflictError(
          'La solicitud de viaje ya fue asignada a otro conductor',
          'REQUEST_ALREADY_ASSIGNED'
        );
      }

      if (request.status === 'EXPIRED') {
        offer.status = 'EXPIRED';
        this.offers.set(offerId, offer);
        await this.redisService.deleteOffer(offerId);
        throw new ConflictError(
          `La solicitud de viaje no está disponible para ser aceptada (estado: ${request.status})`,
          'REQUEST_NOT_AVAILABLE'
        );
      }

      // Asignar de inmediato para bloquear condiciones de carrera
      request.status = 'ASSIGNED';
      request.assignedDriverId = offer.driverId;
      request.updatedAt = now.toISOString();
      this.requests.set(request.id, request);

      offer.status = 'ACCEPTED';
      this.offers.set(offerId, offer);
      await this.redisService.deleteOffer(offerId);

      // Expirar e invalidar las demás ofertas en memoria y en Redis
      const otherOffers = Array.from(this.offers.values()).filter(
        (o) => o.requestId === request.id && o.id !== offer.id && o.status === 'PENDING'
      );
      for (const other of otherOffers) {
        other.status = 'EXPIRED';
        this.offers.set(other.id, other);
        await this.redisService.deleteOffer(other.id);
      }

      this.auditEvents.push({
        eventId: `evt_${randomUUID()}`,
        requestId: request.id,
        eventType: 'ASSIGNED',
        actorId: offer.driverId,
        actorType: 'DRIVER',
        payload: { offerId: offer.id, driverId: offer.driverId },
        timestamp: now.toISOString()
      });

      // Publicar evento de asignación en RabbitMQ hacia M6 y M8
      try {
        await this.rabbitmqService.publishTripAssigned({
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
      } catch (err) {
        console.warn(`[RabbitMQ] Fallo al publicar asignación: ${(err as Error).message}`);
      }

      console.log(
        `[RF-5.4 / RF-5.5] Oferta ${offer.id} ACEPTADA por conductor ${offer.driverId}. Solicitud ${request.id} ASIGNADA exclusivamente a ${offer.driverId}.`
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
    } finally {
      await this.redisService.releaseLock(lockKey);
    }
  }

  /**
   * RF-5.6: Cancelación previa de solicitud
   * Permite al cliente cancelar una solicitud de viaje antes de su asignación a un conductor.
   * Backing Services:
   * - Redis: Invalidación inmediata de ofertas activas y marca de solicitud cancelada para bloquear carreras.
   * - RabbitMQ: Publicación de evento asíncrono para notificar a M6 y M8.
   * - Persistencia: Cambio oficial a CANCELLED y registro inmutable en auditoría (RNF-04).
   */
  public async cancelRideRequest(
    requestId: string,
    clientId: string,
    dto?: CancelRideRequestDTO
  ): Promise<CancelRideRequestResponseDTO> {
    // 1. Validar DTO
    const validation = RideRequestValidator.validateCancelRequestDTO(dto);
    if (!validation.valid) {
      throw new ValidationError('Parámetros de cancelación inválidos', validation.errors);
    }

    // 2. Obtener y verificar solicitud y pertenencia
    const request = await this.getRideRequestById(requestId, clientId);

    // 3. Adquirir lock distribuido para sincronizar con posible aceptación concurrente
    const lockKey = `request:${request.id}`;
    await this.redisService.acquireLock(lockKey, 3000);

    try {
      // 4. Validar reglas de negocio para cancelación previa
      if (request.status === 'ASSIGNED') {
        throw new ConflictError(
          'No es posible realizar una cancelación previa: la solicitud ya ha sido asignada a un conductor',
          'REQUEST_ALREADY_ASSIGNED'
        );
      }

      if (request.status === 'CANCELLED') {
        throw new ConflictError(
          'La solicitud de viaje ya se encuentra cancelada',
          'REQUEST_ALREADY_CANCELLED'
        );
      }

      if (request.status === 'EXPIRED') {
        throw new ConflictError(
          'La solicitud de viaje ha expirado y no puede ser cancelada',
          'REQUEST_EXPIRED'
        );
      }

      // 5. Actualizar estado de la solicitud a CANCELLED
      const now = new Date();
      const prevStatus = request.status;
      request.status = 'CANCELLED';
      request.updatedAt = now.toISOString();
      request.cancelledAt = now.toISOString();
      if (dto?.reason && dto.reason.trim().length > 0) {
        request.cancellationReason = dto.reason.trim();
      }
      this.requests.set(request.id, request);

      // 6. Redis: Marcar cancelación atómica e invalidar todas las ofertas pendientes (RNF-06)
      await this.redisService.markRequestCancelled(request.id, 3600);

      const affectedOffers = Array.from(this.offers.values()).filter(
        (o) => o.requestId === request.id && o.status === 'PENDING'
      );
      const affectedOfferIds = affectedOffers.map((o) => o.id);
      const affectedDriverIds = affectedOffers.map((o) => o.driverId);

      // Invalidación masiva en Redis
      await this.redisService.invalidateOffersForRequest(affectedOfferIds);

      // Expirar ofertas en memoria
      affectedOffers.forEach((pendingOffer) => {
        pendingOffer.status = 'EXPIRED';
        this.offers.set(pendingOffer.id, pendingOffer);
      });

      // 7. RabbitMQ: Publicar evento asíncrono para M6 y M8 (RNF-07)
      await this.rabbitmqService.publishRideRequestCancelled({
        eventType: 'RIDE_REQUEST_CANCELLED',
        requestId: request.id,
        clientId: request.clientId,
        reason: request.cancellationReason,
        affectedDriverIds,
        cancelledAt: request.cancelledAt,
        correlationId: `corr_${randomUUID()}`,
        timestamp: now.toISOString()
      });

      // 8. Persistencia de auditoría inmutable (RNF-04)
      this.auditEvents.push({
        eventId: `evt_${randomUUID()}`,
        requestId: request.id,
        eventType: 'CANCELLED_BY_CLIENT',
        actorId: clientId,
        actorType: 'CLIENT',
        payload: {
          reason: request.cancellationReason,
          affectedDriversCount: affectedDriverIds.length,
          affectedDriverIds,
          previousStatus: prevStatus
        },
        timestamp: now.toISOString()
      });

      console.log(
        `[RF-5.6] Solicitud de viaje ${request.id} CANCELADA por cliente ${clientId}. Motivo="${request.cancellationReason || 'Sin motivo especificado'}" | Conductores liberados: ${affectedDriverIds.length}`
      );

      return {
        requestId: request.id,
        clientId: request.clientId,
        status: 'CANCELLED',
        reason: request.cancellationReason,
        cancelledAt: request.cancelledAt,
        message: 'Solicitud de viaje cancelada exitosamente por el cliente.'
      };
    } finally {
      await this.redisService.releaseLock(lockKey);
    }
  }

  /**
   * Obtiene eventos de auditoría inmutables (RNF-04)
   */
  public getAuditEvents(requestId?: string): DispatchAuditEvent[] {
    if (requestId) {
      return this.auditEvents.filter((evt) => evt.requestId === requestId);
    }
    return [...this.auditEvents];
  }

  /**
   * Obtiene una oferta por su ID
   */
  public async getOfferById(offerId: string): Promise<RideOffer> {
    const offer = this.offers.get(offerId);
    if (!offer) {
      throw new NotFoundError('Oferta no encontrada', 'OFFER_NOT_FOUND');
    }
    const now = new Date().getTime();
    if (offer.status === 'PENDING' && new Date(offer.expiresAt).getTime() < now) {
      offer.status = 'EXPIRED';
      this.offers.set(offerId, offer);
    }
    return offer;
  }

  /**
   * Obtiene las ofertas dirigidas a un conductor específico
   */
  public async getOffersForDriver(driverId: string): Promise<RideOffer[]> {
    const now = new Date().getTime();
    return Array.from(this.offers.values())
      .filter((offer) => offer.driverId === driverId)
      .map((offer) => {
        const req = this.requests.get(offer.requestId);
        const isAssignedToOther = req && req.status === 'ASSIGNED' && req.assignedDriverId !== driverId;
        const isReqClosed = req && (req.status === 'EXPIRED' || req.status === 'NO_DRIVERS_AVAILABLE' || req.status === 'CANCELLED');
        const isTimeExpired = new Date(offer.expiresAt).getTime() < now;

        if (offer.status === 'PENDING' && (isTimeExpired || isAssignedToOther || isReqClosed)) {
          offer.status = 'EXPIRED';
          this.offers.set(offer.id, offer);
        }
        return offer;
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  /**
   * Obtiene todas las ofertas activas en el sistema
   */
  public async getAllOffers(): Promise<RideOffer[]> {
    const now = new Date().getTime();
    return Array.from(this.offers.values())
      .map((offer) => {
        const req = this.requests.get(offer.requestId);
        const isAssigned = req && req.status === 'ASSIGNED';
        const isReqClosed = req && (req.status === 'EXPIRED' || req.status === 'CANCELLED');
        const isTimeExpired = new Date(offer.expiresAt).getTime() < now;

        if (offer.status === 'PENDING' && (isTimeExpired || isAssigned || isReqClosed)) {
          offer.status = 'EXPIRED';
          this.offers.set(offer.id, offer);
        }
        return offer;
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  /**
   * Manejador de eventos de RabbitMQ en la cola 'despacho.reabrir'
   * Procesa la cancelación de un conductor y reabre automáticamente el despacho para nuevos candidatos.
   */
  public async handleDriverCancellation(event: DriverCancellationEvent): Promise<void> {
    const requestId = event.viajeId;
    const clientId = event.clienteId;
    const cancelledDriverId = event.conductorId;

    console.log(
      `[RabbitMQ] Recibido evento '${event.evento}' en 'despacho.reabrir' para Viaje=${requestId} | Cliente=${clientId} | ConductorCanceló=${cancelledDriverId}`
    );

    const request = this.requests.get(requestId);
    if (!request) {
      console.warn(`[RabbitMQ] Solicitud de viaje ${requestId} no encontrada para reapertura de despacho.`);
      return;
    }

    // 1. Reabrir estado de la solicitud: quitar asignación y regresar a SEARCHING
    request.assignedDriverId = null;
    request.status = 'SEARCHING';
    request.updatedAt = new Date().toISOString();
    this.requests.set(requestId, request);

    // 2. Marcar como expiradas las ofertas pendientes asociadas
    for (const offer of this.offers.values()) {
      if (offer.requestId === requestId && (offer.status === 'PENDING' || offer.driverId === cancelledDriverId)) {
        offer.status = 'EXPIRED';
        this.offers.set(offer.id, offer);
        await this.redisService.deleteOffer(offer.id);
      }
    }

    // 3. Buscar nuevos candidatos excluyendo al conductor que canceló
    try {
      const candidatesResult = await this.searchCandidatesForRequest(requestId, clientId, {
        radiusKm: 5.0,
        maxCandidates: 5
      });

      const filteredCandidates = candidatesResult.candidates.filter(
        (c) => c.driverId !== cancelledDriverId
      );

      if (filteredCandidates.length > 0) {
        // 4. Emitir nuevas ofertas con vencimiento (TTL) en Redis y publicar en RabbitMQ
        await this.sendOffersForRequest(requestId, clientId, {
          driverIds: filteredCandidates.map((c) => c.driverId),
          ttlSeconds: 30
        });

        console.log(
          `[RabbitMQ] Despacho reabierto exitosamente para viaje ${requestId}. Nuevas ofertas enviadas a: ${filteredCandidates
            .map((c) => c.driverId)
            .join(', ')}`
        );
      } else {
        console.warn(
          `[RabbitMQ] No se encontraron otros conductores disponibles para el viaje ${requestId} (distintos a ${cancelledDriverId}).`
        );
      }
    } catch (err) {
      console.warn(`[RabbitMQ] No fue posible reasignar candidatos automáticamente: ${(err as Error).message}`);
    }
  }
}
