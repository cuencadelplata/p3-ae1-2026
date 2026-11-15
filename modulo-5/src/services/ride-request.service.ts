import {
  CandidateDriver,
  CandidateSearchResponseDTO,
  CancelRideRequestDTO,
  CancelRideRequestResponseDTO,
  CreateRideRequestDTO,
  EstimatedFare,
  NearbyDriverStub,
  OfferAction,
  OfferAuditEntry,
  OfferAuditEvent,
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
import { randomUUID } from 'node:crypto';
import { RedisService } from './redis.service';
import { RabbitMQService, DriverCancellationEvent } from './rabbitmq.service';
import { M4ClientService, M4IntegrationError } from './m4-client.service';

export { M4IntegrationError } from './m4-client.service';

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
 * Servicio de Solicitud y Despacho (Módulo 5)
 */
export class RideRequestService {
  // Almacén en memoria simulando la persistencia de DispatchDB / MobilityDB (AE1)
  private requests: Map<string, RideRequest> = new Map();
  private idempotencyStore: Map<string, RideRequest> = new Map();
  private offers: Map<string, RideOffer> = new Map();

  // RF-5.8: Registro de trazabilidad de ofertas y timeouts (RNF-04)
  // Se persisten en memoria los eventos mínimos para reconstruir el historial.
  // En producción se volcarian a DispatchDB o sistema de logs centralizado.
  private offerAuditLog: OfferAuditEntry[] = [];

  // Servicios de soporte para AE2 (RNF-06 y RNF-07)
  private redisService: RedisService;
  private rabbitMQService: RabbitMQService;
  private m4ClientService: M4ClientService;

  // RF-5.3: Timer en segundo plano para revisar activamente vencimientos de ofertas y solicitudes
  private expirationInterval: NodeJS.Timeout | null = null;

  constructor(
    redisService?: RedisService,
    rabbitMQService?: RabbitMQService,
    m4ClientService?: M4ClientService,
    enableBackgroundWorker: boolean = true
  ) {
    this.redisService = redisService || new RedisService();
    this.rabbitMQService = rabbitMQService || new RabbitMQService();
    this.m4ClientService = m4ClientService || new M4ClientService();

    // Suscribirse a la cola despacho.reabrir para atender cancelaciones de conductor (integración con módulo de cancelaciones)
    this.rabbitMQService.subscribeToReopenDispatch((event) => this.handleDriverCancellation(event));

    // RF-5.3: Iniciar proceso periódico en segundo plano para cerrar ofertas y solicitudes vencidas
    if (enableBackgroundWorker) {
      this.startExpirationWorker();
    }
  }

  /**
   * RF-5.3: Proceso periódico en segundo plano que revisa vencimientos
   * Permite que las ofertas y búsquedas vencidas se cierren de forma autónoma
   * sin requerir que un cliente haga una consulta o respuesta.
   */
  public startExpirationWorker(intervalMs: number = 1000): void {
    if (this.expirationInterval) return;

    this.expirationInterval = setInterval(() => {
      this.processActiveExpirations();
    }, intervalMs);

    // Evitar que el timer impida que Node.js finalice limpiamente
    if (this.expirationInterval.unref) {
      this.expirationInterval.unref();
    }
  }

  /**
   * Detiene el worker de expiración en segundo plano (para limpieza o tests)
   */
  public stopExpirationWorker(): void {
    if (this.expirationInterval) {
      clearInterval(this.expirationInterval);
      this.expirationInterval = null;
    }
  }

  /**
   * Ejecuta una pasada activa de expiración sobre todas las solicitudes y ofertas activas (RF-5.3 / RF-5.8)
   */
  public processActiveExpirations(): void {
    const now = Date.now();

    // 1. Expirar solicitudes activas cuyo plazo total de búsqueda venció
    for (const request of this.requests.values()) {
      if (
        (request.status === 'PENDING' || request.status === 'SEARCHING' || request.status === 'OFFERED') &&
        new Date(request.expiresAt).getTime() < now
      ) {
        const prevStatus = request.status;
        request.status = 'EXPIRED';
        request.updatedAt = new Date().toISOString();
        this.logOfferEvent('SEARCH_TIMEOUT', request.id,
          'Plazo total de búsqueda agotado por worker en segundo plano.', {
            previousStatus: prevStatus,
            newStatus: 'EXPIRED'
          });
        console.log(`[RF-5.8] BackgroundWorker: Solicitud ${request.id} expirada por timeout.`);
      }

      // Si la solicitud estaba en OFFERED, chequear si toda su tanda de ofertas venció
      if (request.status === 'OFFERED') {
        this.checkBatchExpiration(request.id);
      }
    }

    // 2. Expirar ofertas individuales en estado PENDING cuyo TTL venció
    for (const offer of this.offers.values()) {
      if (offer.status === 'PENDING' && new Date(offer.expiresAt).getTime() < now) {
        offer.status = 'EXPIRED';
        this.offers.set(offer.id, offer);
        this.redisService.deleteOffer(offer.id).catch(() => {});
        this.logOfferEvent('OFFER_EXPIRED', offer.requestId,
          'Oferta expirada activamente por worker en segundo plano (sin respuesta del conductor)', {
            offerId: offer.id,
            driverId: offer.driverId,
            previousStatus: 'PENDING',
            newStatus: 'EXPIRED'
          });
        console.log(`[RF-5.3] BackgroundWorker: Oferta ${offer.id} expirada activamente por TTL.`);
      }
    }
  }

  public getRedisService(): RedisService {
    return this.redisService;
  }

  public getRabbitMQService(): RabbitMQService {
    return this.rabbitMQService;
  }

  public getM4ClientService(): M4ClientService {
    return this.m4ClientService;
  }

  // =========================================================================
  //  RF-5.8: Trazabilidad de ofertas y timeout (AE2 p.29; RNF-04)
  // =========================================================================

  /**
   * Registra un evento de auditoría en el log de trazabilidad de ofertas.
   */
  private logOfferEvent(
    event: OfferAuditEvent,
    requestId: string,
    details: string,
    extra?: { offerId?: string; driverId?: string; previousStatus?: string; newStatus?: string }
  ): void {
    this.offerAuditLog.push({
      timestamp: new Date().toISOString(),
      event,
      requestId,
      offerId: extra?.offerId,
      driverId: extra?.driverId,
      previousStatus: extra?.previousStatus,
      newStatus: extra?.newStatus,
      details
    });
  }

  /**
   * Consulta el log de auditoría de ofertas (RF-5.8).
   * Permite filtrar por requestId para obtener la trazabilidad de una solicitud específica.
   */
  public getOfferAuditLog(requestId?: string): OfferAuditEntry[] {
    if (requestId) return this.offerAuditLog.filter((e) => e.requestId === requestId);
    return [...this.offerAuditLog];
  }

  /**
   * RF-5.3 / RF-5.7 / RF-5.8: Verifica si toda la tanda de ofertas de una solicitud venció.
   * - Si el plazo de búsqueda (expiresAt) NO pasó → vuelve a SEARCHING (nueva ronda permitida).
   * - Si el plazo de búsqueda SÍ pasó → EXPIRED + registra SEARCH_TIMEOUT.
   * Se llama de forma lazy al consultar ofertas.
   */
  private checkBatchExpiration(requestId: string): void {
    const request = this.requests.get(requestId);
    if (!request || (request.status !== 'OFFERED')) return;

    const relatedOffers = Array.from(this.offers.values()).filter((o) => o.requestId === requestId);
    if (relatedOffers.length === 0) return;

    const now = Date.now();

    // Lazy-expire ofertas PENDING cuyo TTL venció sin respuesta
    for (const offer of relatedOffers) {
      if (offer.status === 'PENDING' && new Date(offer.expiresAt).getTime() < now) {
        offer.status = 'EXPIRED';
        this.offers.set(offer.id, offer);
        this.logOfferEvent('OFFER_EXPIRED', requestId, `Oferta expirada por TTL sin respuesta del conductor`, {
          offerId: offer.id,
          driverId: offer.driverId,
          previousStatus: 'PENDING',
          newStatus: 'EXPIRED'
        });
      }
    }

    // ¿Todas las ofertas de la tanda finalizaron (ninguna PENDING)?
    const allDone = relatedOffers.every((o) => o.status !== 'PENDING');
    if (!allDone) return;

    const searchDeadlinePassed = new Date(request.expiresAt).getTime() < now;
    const prevStatus = request.status;

    if (searchDeadlinePassed) {
      // Plazo de búsqueda agotado → cerrar definitivamente
      request.status = 'EXPIRED';
      request.updatedAt = new Date().toISOString();
      this.requests.set(requestId, request);
      this.logOfferEvent('SEARCH_TIMEOUT', requestId,
        'Plazo de búsqueda agotado. Todas las ofertas finalizaron sin asignación.', {
          previousStatus: prevStatus,
          newStatus: 'EXPIRED'
        });
      console.log(`[RF-5.8] SEARCH_TIMEOUT: Solicitud ${requestId} expirada (plazo de búsqueda agotado).`);
    } else {
      // Plazo de búsqueda vigente → permitir nueva ronda (no cerrar la búsqueda)
      request.status = 'SEARCHING';
      request.updatedAt = new Date().toISOString();
      this.requests.set(requestId, request);
      this.logOfferEvent('BATCH_TIMEOUT', requestId,
        'Tanda de ofertas vencida sin asignación. Solicitud regresa a SEARCHING para nueva ronda.', {
          previousStatus: prevStatus,
          newStatus: 'SEARCHING'
        });
      console.log(`[RF-5.3] BATCH_TIMEOUT: Tanda vencida para solicitud ${requestId}. Nueva ronda habilitada.`);
    }
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

    // Actualizar solicitudes previas que hayan expirado por tiempo
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

    // 3. Verificar que el cliente no tenga otra solicitud activa pendiente/en búsqueda
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

    // 7. Persistir en almacenamiento
    this.requests.set(newRequest.id, newRequest);
    this.idempotencyStore.set(idempotencyKey, newRequest);

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

    // Control de acceso multi-tenant básico
    if (request.clientId !== clientId) {
      throw new ConflictError('No tiene permisos para acceder a esta solicitud', 'FORBIDDEN_ACCESS');
    }

    return request;
  }

  /**
   * Búsqueda de candidatos (RF-5.2)
   * Filtra conductores disponibles por proximidad y tipo de vehículo compatible.
   */
  public async searchCandidatesForRequest(
    requestId: string,
    clientId: string,
    options?: SearchCandidatesOptions
  ): Promise<CandidateSearchResponseDTO> {
    // 1. Validar opciones de búsqueda si se proporcionaron
    const validation = RideRequestValidator.validateSearchCandidatesOptions(options);
    if (!validation.valid) {
      throw new ValidationError('Parámetros de búsqueda de candidatos inválidos', validation.errors);
    }

    const radiusKm = options?.radiusKm ?? 5.0; // Radio configurable por defecto: 5 km
    const maxCandidates = options?.maxCandidates ?? 5;

    // 2. Obtener y validar la solicitud de viaje existente (RF-5.1)
    const request = await this.getRideRequestById(requestId, clientId);

    const validSearchStatuses = ['PENDING', 'SEARCHING', 'OFFERED', 'NO_DRIVERS_AVAILABLE'];
    if (!validSearchStatuses.includes(request.status)) {
      throw new ConflictError(
        `No se pueden buscar candidatos para una solicitud en estado ${request.status}`,
        'INVALID_REQUEST_STATE'
      );
    }

    // 3. Consumir conductores cercanos desde M4 (RF-4.2 / RF-5.2)
    const nearby = await this.fetchNearbyDriversFromM4(
      request.origin.latitude,
      request.origin.longitude,
      request.vehicleType,
      radiusKm,
      maxCandidates
    );

    // 4. Algoritmo de filtrado y ordenamiento:
    // - Filtro de compatibilidad de vehículo (Auto/Moto)
    // - Filtro de proximidad (distancia <= radio configurado)
    // - Ordenamiento ascendente por proximidad (menor distancia / ETA primero)
    const candidates: CandidateDriver[] = nearby
      .filter((driver) => driver.vehicleType === request.vehicleType && driver.distanceKm <= radiusKm)
      .sort((a, b) => a.distanceKm - b.distanceKm)
      .slice(0, maxCandidates)
      .map((driver) => ({
        driverId: driver.driverId,
        vehicleType: driver.vehicleType,
        distanceKm: Math.round(driver.distanceKm * 100) / 100,
        estimatedEtaMinutes: Math.max(1, Math.round(driver.distanceKm * 3)), // ~3 min por km urbano
        rating: driver.rating ?? 4.8
      }));

    // 5. Manejo de resultado sin candidatos (RF-5.7)
    if (candidates.length === 0) {
      request.status = 'NO_DRIVERS_AVAILABLE';
      request.updatedAt = new Date().toISOString();
      this.requests.set(requestId, request);

      throw new NotFoundError(
        `No se encontraron conductores de tipo ${request.vehicleType} disponibles dentro del radio de ${radiusKm} km`,
        'NO_DRIVERS_AVAILABLE'
      );
    }

    // Si había estado NO_DRIVERS_AVAILABLE y ahora hay candidatos, vuelve a SEARCHING
    if (request.status === 'NO_DRIVERS_AVAILABLE') {
      request.status = 'SEARCHING';
      request.updatedAt = new Date().toISOString();
      this.requests.set(requestId, request);
    }

    console.log(
      `[RF-5.2] Búsqueda de candidatos para solicitud ${requestId}: Radio=${radiusKm}km | Tipo=${request.vehicleType} | Encontrados=${candidates.length} [${candidates.map((c) => `${c.driverId} (${c.distanceKm}km, ETA ${c.estimatedEtaMinutes}m)`).join(', ')}]`
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
   * RF-5.3: Oferta con vencimiento
   * Envía una oferta a uno o más conductores con tiempo máximo de respuesta (TTL).
   */
  public async sendOffersForRequest(
    requestId: string,
    clientId: string,
    dto?: SendOffersDTO
  ): Promise<SendOffersResponseDTO> {
    // 1. Validar DTO
    const validation = RideRequestValidator.validateSendOffersDTO(dto);
    if (!validation.valid) {
      throw new ValidationError('Parámetros de envío de ofertas inválidos', validation.errors);
    }

    const ttlSeconds = dto?.ttlSeconds ?? 30; // Tiempo por defecto: 30 segundos

    // 2. Obtener solicitud de viaje y verificar estado
    const request = await this.getRideRequestById(requestId, clientId);

    // RF-5.3 / RNF-09: Verificar si la solicitud ha expirado por tiempo antes de generar ofertas
    const nowCheck = Date.now();
    if (new Date(request.expiresAt).getTime() < nowCheck) {
      request.status = 'EXPIRED';
      request.updatedAt = new Date().toISOString();
      this.requests.set(requestId, request);
      throw new ConflictError(
        'La solicitud de viaje ha expirado y no permite generar nuevas ofertas',
        'REQUEST_EXPIRED'
      );
    }

    const validOfferStatuses = ['PENDING', 'SEARCHING', 'OFFERED', 'NO_DRIVERS_AVAILABLE'];
    if (!validOfferStatuses.includes(request.status)) {
      throw new ConflictError(
        `No se pueden enviar ofertas para una solicitud en estado ${request.status}`,
        'INVALID_REQUEST_STATE'
      );
    }

    // 3. Determinar lista de conductores destinatarios
    let targetDriverIds = dto?.driverIds;
    if (!targetDriverIds || targetDriverIds.length === 0) {
      // Si no se pasaron IDs explícitos, busca los mejores candidatos automáticamente (RF-5.2)
      const candidatesResult = await this.searchCandidatesForRequest(requestId, clientId, {
        radiusKm: 5.0,
        maxCandidates: 3
      });
      targetDriverIds = candidatesResult.candidates.map((c) => c.driverId);
    } else {
      // RF-5.3 Fix 1: driverIds explícitos NO deben saltear la validación de elegibilidad.
      // Validar contra M4 (o simulación aprobada) que sean candidatos disponibles (RF-5.2/5.3).
      targetDriverIds = [...new Set(targetDriverIds)]; // Fix 3: Deduplicar IDs

      const nearbyDrivers = await this.fetchNearbyDriversFromM4(
        request.origin.latitude,
        request.origin.longitude,
        request.vehicleType
      );
      const eligibleDriverIds = new Set(nearbyDrivers.map((d) => d.driverId));

      const invalidIds = targetDriverIds.filter((id) => !eligibleDriverIds.has(id));
      if (invalidIds.length > 0) {
        console.warn(
          `[RF-5.3] driverIds explícitos descartados (no elegibles/disponibles en M4): ${invalidIds.join(', ')}`
        );
      }

      targetDriverIds = targetDriverIds.filter((id) => eligibleDriverIds.has(id));
    }

    if (targetDriverIds.length === 0) {
      throw new NotFoundError(
        'No se encontraron conductores candidatos para despachar la oferta',
        'NO_DRIVERS_AVAILABLE'
      );
    }

    // RF-5.3 Fix 3: Evitar ofertas duplicadas — descartar conductores que ya tienen oferta PENDING
    const existingPendingDriverIds = new Set(
      Array.from(this.offers.values())
        .filter((o) => o.requestId === requestId && o.status === 'PENDING')
        .map((o) => o.driverId)
    );
    const duplicateIds = targetDriverIds.filter((id) => existingPendingDriverIds.has(id));
    if (duplicateIds.length > 0) {
      console.warn(
        `[RF-5.3] driverIds con oferta PENDING existente descartados: ${duplicateIds.join(', ')}`
      );
    }
    targetDriverIds = targetDriverIds.filter((id) => !existingPendingDriverIds.has(id));

    if (targetDriverIds.length === 0) {
      throw new ConflictError(
        'Todos los conductores indicados ya poseen una oferta pendiente para esta solicitud',
        'DUPLICATE_OFFERS'
      );
    }

    // 4. Crear las ofertas con TTL
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

      // RF-5.8: Registrar creación de oferta en log de trazabilidad
      this.logOfferEvent('OFFER_CREATED', request.id,
        `Oferta creada para conductor ${driverId} con TTL ${ttlSeconds}s`, {
          offerId: offer.id,
          driverId,
          newStatus: 'PENDING'
        });

      // RF-5.3 / RNF-06: Persistir oferta en Redis con expiración automática (TTL)
      await this.redisService.saveOfferWithTtl(offer, ttlSeconds);

      // RF-5.3 / RNF-07: Publicar mensaje asíncrono a RabbitMQ para avisar al conductor
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
    }

    // 5. Transicionar estado de la solicitud a OFFERED
    request.status = 'OFFERED';
    request.updatedAt = now.toISOString();
    this.requests.set(requestId, request);

    console.log(
      `[RF-5.3] Ofertas despachadas con Redis TTL (${ttlSeconds}s) y RabbitMQ: Solicitud=${request.id} | Cantidad=${createdOffers.length} | Conductores=[${createdOffers.map((o) => `${o.driverId} (Oferta: ${o.id})`).join(', ')}]`
    );

    return {
      requestId: request.id,
      offersSentCount: createdOffers.length,
      offers: createdOffers,
      message: `Oferta enviada exitosamente a ${createdOffers.length} conductor(es) con TTL de ${ttlSeconds}s (Redis + RabbitMQ).`
    };
  }

  /**
   * Consulta las ofertas activas o históricas asociadas a una solicitud
   */
  public async getOffersByRequestId(requestId: string, clientId: string): Promise<RideOffer[]> {
    await this.getRideRequestById(requestId, clientId); // Valida existencia y permisos

    const now = new Date().getTime();
    const requestOffers = Array.from(this.offers.values())
      .filter((offer) => offer.requestId === requestId)
      .map((offer) => {
        // Expirar ofertas pasadas de TTL de forma dinámica si aún figuraban PENDING
        if (offer.status === 'PENDING' && new Date(offer.expiresAt).getTime() < now) {
          offer.status = 'EXPIRED';
          this.logOfferEvent('OFFER_EXPIRED', requestId, `Oferta expirada por TTL (lazy check)`, {
            offerId: offer.id,
            driverId: offer.driverId,
            previousStatus: 'PENDING',
            newStatus: 'EXPIRED'
          });
        }
        return offer;
      });

    // RF-5.3 / RF-5.7: Verificar si toda la tanda expiró para definir siguiente estado
    this.checkBatchExpiration(requestId);

    return requestOffers;
  }

  /**
   * RF-5.4: Aceptar o rechazar oferta
   * Permite a un conductor responder a una oferta mientras se encuentre vigente.
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

    // 2. Buscar la oferta
    const offer = this.offers.get(offerId);
    if (!offer) {
      throw new NotFoundError('Oferta de viaje no encontrada', 'OFFER_NOT_FOUND');
    }

    // 3. Validar que el conductor sea el destinatario de la oferta (si no es demo default)
    if (targetDriverId !== 'driver_demo_default' && offer.driverId !== targetDriverId) {
      throw new ConflictError(
        'No tiene autorización para responder a esta oferta (destinatario no coincide)',
        'FORBIDDEN_ACCESS'
      );
    }

    // 4. Verificar vigencia por tiempo (TTL con Redis)
    const remainingTtl = await this.redisService.getRemainingTtl(offerId);
    const now = new Date();
    const nowTime = now.getTime();
    const expiresAtTime = new Date(offer.expiresAt).getTime();

    if (remainingTtl === -2 || nowTime > expiresAtTime || offer.status === 'EXPIRED') {
      offer.status = 'EXPIRED';
      this.offers.set(offerId, offer);
      await this.redisService.deleteOffer(offerId);
      this.logOfferEvent('OFFER_EXPIRED', offer.requestId,
        `Intento de respuesta tardía sobre oferta expirada (TTL o plazo vencido)`, {
          offerId,
          driverId: targetDriverId,
          previousStatus: 'PENDING',
          newStatus: 'EXPIRED'
        });
      throw new ConflictError(
        'La oferta ha expirado y ya no está vigente',
        'OFFER_EXPIRED'
      );
    }

    // 5. Verificar que la oferta esté en estado PENDING
    if (offer.status !== 'PENDING') {
      throw new ConflictError(
        `La oferta ya fue respondida previamente y se encuentra en estado ${offer.status}`,
        'OFFER_ALREADY_RESPONDED'
      );
    }

    // 6. Obtener la solicitud asociada
    const request = this.requests.get(offer.requestId);
    if (!request) {
      throw new NotFoundError('Solicitud de viaje asociada no encontrada', 'RIDE_REQUEST_NOT_FOUND');
    }

    if (action === 'REJECT') {
      offer.status = 'REJECTED';
      this.offers.set(offerId, offer);
      // Eliminar de Redis ya que no está disponible
      await this.redisService.deleteOffer(offerId);

      this.logOfferEvent('OFFER_REJECTED', request.id,
        `Oferta rechazada por el conductor ${offer.driverId}`, {
          offerId: offer.id,
          driverId: offer.driverId,
          previousStatus: 'PENDING',
          newStatus: 'REJECTED'
        });

      // Si todas las ofertas para esta solicitud fueron rechazadas o expiraron, verificar si toda la tanda terminó
      const relatedOffers = Array.from(this.offers.values()).filter(
        (o) => o.requestId === request.id
      );
      const allDone = relatedOffers.every(
        (o) => o.status === 'REJECTED' || o.status === 'EXPIRED'
      );
      if (allDone && request.status === 'OFFERED') {
        const searchDeadlinePassed = new Date(request.expiresAt).getTime() < nowTime;
        if (searchDeadlinePassed) {
          request.status = 'EXPIRED';
          request.updatedAt = now.toISOString();
          this.requests.set(request.id, request);
          this.logOfferEvent('SEARCH_TIMEOUT', request.id,
            'Plazo de búsqueda agotado tras rechazo/expiración de todas las ofertas.', {
              previousStatus: 'OFFERED',
              newStatus: 'EXPIRED'
            });
        } else {
          // Si aún tiene plazo de búsqueda, regresa a SEARCHING para permitir nueva ronda o candidatos (RF-5.3/5.7)
          request.status = 'SEARCHING';
          request.updatedAt = now.toISOString();
          this.requests.set(request.id, request);
          this.logOfferEvent('BATCH_TIMEOUT', request.id,
            'Tanda de ofertas rechazada en su totalidad. Regresa a SEARCHING para permitir nueva ronda.', {
              previousStatus: 'OFFERED',
              newStatus: 'SEARCHING'
            });
        }
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

    // action === 'ACCEPT'
    // 7. Si la acción es aceptar, validar que la solicitud aún esté disponible para ser asignada
    if (request.status === 'ASSIGNED') {
      offer.status = 'EXPIRED'; // La oferta queda revocada porque ya se asignó a otro
      this.offers.set(offerId, offer);
      await this.redisService.deleteOffer(offerId);
      throw new ConflictError(
        'La solicitud de viaje ya fue asignada a otro conductor',
        'REQUEST_ALREADY_ASSIGNED'
      );
    }

    if (request.status === 'CANCELLED') {
      offer.status = 'EXPIRED';
      this.offers.set(offerId, offer);
      await this.redisService.deleteOffer(offerId);
      throw new ConflictError(
        'La solicitud de viaje fue cancelada por el cliente y ya no se encuentra disponible',
        'REQUEST_CANCELLED'
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

    // 8. Asignar la solicitud y marcar la oferta como ACCEPTED
    offer.status = 'ACCEPTED';
    this.offers.set(offerId, offer);
    await this.redisService.deleteOffer(offerId);

    request.status = 'ASSIGNED';
    request.assignedDriverId = offer.driverId;
    request.updatedAt = now.toISOString();
    this.requests.set(request.id, request);

    this.logOfferEvent('OFFER_ACCEPTED', request.id,
      `Oferta ${offer.id} aceptada por conductor ${offer.driverId}. Viaje asignado.`, {
        offerId: offer.id,
        driverId: offer.driverId,
        previousStatus: 'PENDING',
        newStatus: 'ACCEPTED'
      });

    // 9. Cancelar / expirar automáticamente las demás ofertas pendientes para esta misma solicitud
    for (const otherOffer of Array.from(this.offers.values()).filter(
      (o) => o.requestId === request.id && o.id !== offer.id && o.status === 'PENDING'
    )) {
      otherOffer.status = 'EXPIRED';
      this.offers.set(otherOffer.id, otherOffer);
      await this.redisService.deleteOffer(otherOffer.id);
      this.logOfferEvent('OFFER_EXPIRED', request.id,
        `Oferta revocada por asignación concurrente a ${offer.driverId}`, {
          offerId: otherOffer.id,
          driverId: otherOffer.driverId,
          previousStatus: 'PENDING',
          newStatus: 'EXPIRED'
        });
    }

    console.log(
      `[RF-5.4 / RF-5.5] Oferta ${offer.id} ACEPTADA por conductor ${offer.driverId}. Solicitud ${request.id} ASIGNADA exclusivamente a ${offer.driverId}. Ofertas restantes limpiadas de Redis.`
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
   * Permite al cliente cancelar una solicitud de viaje antes de su asignación a un conductor.
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

    // 2. Obtener y verificar la solicitud existente y pertenencia de cliente
    const request = await this.getRideRequestById(requestId, clientId);

    // 3. Validar reglas de negocio para cancelación previa
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

    // 4. Actualizar estado de la solicitud a CANCELLED
    const now = new Date();
    request.status = 'CANCELLED';
    request.updatedAt = now.toISOString();
    request.cancelledAt = now.toISOString();
    if (dto?.reason && dto.reason.trim().length > 0) {
      request.cancellationReason = dto.reason.trim();
    }
    this.requests.set(request.id, request);

    // 5. Invalidar/expirar inmediatamente todas las ofertas asociadas que sigan pendientes
    for (const pendingOffer of Array.from(this.offers.values()).filter(
      (o) => o.requestId === request.id && o.status === 'PENDING'
    )) {
      pendingOffer.status = 'EXPIRED';
      this.offers.set(pendingOffer.id, pendingOffer);
      await this.redisService.deleteOffer(pendingOffer.id);
      this.logOfferEvent('OFFER_EXPIRED', request.id,
        'Oferta expirada/revocada por cancelación previa del viaje', {
          offerId: pendingOffer.id,
          driverId: pendingOffer.driverId,
          previousStatus: 'PENDING',
          newStatus: 'EXPIRED'
        });
    }

    console.log(
      `[RF-5.6] Solicitud de viaje ${request.id} CANCELADA por cliente ${clientId}. Motivo="${request.cancellationReason || 'Sin motivo especificado'}". Ofertas en Redis eliminadas.`
    );

    return {
      requestId: request.id,
      clientId: request.clientId,
      status: 'CANCELLED',
      reason: request.cancellationReason,
      cancelledAt: request.cancelledAt,
      message: 'Solicitud de viaje cancelada exitosamente por el cliente.'
    };
  }

  /**
   * Obtiene una oferta por su ID (consultando Redis para TTL dinámico)
   */
  public async getOfferById(offerId: string): Promise<RideOffer> {
    const offer = this.offers.get(offerId);
    if (!offer) {
      throw new NotFoundError('Oferta no encontrada', 'OFFER_NOT_FOUND');
    }
    const remainingTtl = await this.redisService.getRemainingTtl(offerId);
    const now = new Date().getTime();
    if (offer.status === 'PENDING' && (remainingTtl === -2 || new Date(offer.expiresAt).getTime() < now)) {
      offer.status = 'EXPIRED';
      this.offers.set(offerId, offer);
      await this.redisService.deleteOffer(offerId);
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




