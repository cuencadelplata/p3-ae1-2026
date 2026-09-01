import {
  CandidateDriver,
  CandidateSearchResponseDTO,
  CreateRideRequestDTO,
  EstimatedFare,
  NearbyDriverStub,
  RideOffer,
  RideRequest,
  SearchCandidatesOptions,
  SendOffersDTO,
  SendOffersResponseDTO,
  VehicleType
} from '../types/ride-request.types';
import { RideRequestValidator } from '../schemas/ride-request.schema';
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
 * Servicio de Solicitud y Despacho (Módulo 5)
 */
export class RideRequestService {
  // Almacén en memoria simulando la persistencia de DispatchDB / MobilityDB (AE1)
  private requests: Map<string, RideRequest> = new Map();
  private idempotencyStore: Map<string, RideRequest> = new Map();
  private offers: Map<string, RideOffer> = new Map();


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
    // Simula respuesta de M4 en AE1
    return [
      { driverId: 'drv_101', distanceKm: 1.2, vehicleType },
      { driverId: 'drv_102', distanceKm: 2.1, vehicleType }
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
    if (this.idempotencyStore.has(idempotencyKey)) {
      return this.idempotencyStore.get(idempotencyKey)!;
    }

    // 2. Validar reglas de negocio
    const validation = RideRequestValidator.validateCreateRequest(dto);
    if (!validation.valid) {
      throw new ValidationError('Datos de solicitud inválidos', validation.errors);
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
   * Cancela la solicitud antes de ser asignada (RF-5.6)
   */
  public async cancelRideRequest(requestId: string, clientId: string, _reason?: string): Promise<RideRequest> {
    const request = await this.getRideRequestById(requestId, clientId);

    const cancellableStatuses = ['PENDING', 'SEARCHING', 'OFFERED'];
    if (!cancellableStatuses.includes(request.status)) {
      throw new ConflictError(
        `No se puede cancelar una solicitud en estado ${request.status}. Debe gestionarse en M6 si ya fue asignada.`,
        'CANNOT_CANCEL_REQUEST'
      );
    }

    request.status = 'CANCELLED_BY_CLIENT';
    request.updatedAt = new Date().toISOString();
    this.requests.set(requestId, request);

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

    // 3. Consumir conductores cercanos desde M4 (RF-4.2)
    const nearby = await this.fetchNearbyDriversFromM4(
      request.origin.latitude,
      request.origin.longitude,
      request.vehicleType
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
    }

    if (targetDriverIds.length === 0) {
      throw new NotFoundError(
        'No se encontraron conductores candidatos para despachar la oferta',
        'NO_DRIVERS_AVAILABLE'
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
    }

    // 5. Transicionar estado de la solicitud a OFFERED
    request.status = 'OFFERED';
    request.updatedAt = now.toISOString();
    this.requests.set(requestId, request);

    return {
      requestId: request.id,
      offersSentCount: createdOffers.length,
      offers: createdOffers,
      message: `Oferta enviada exitosamente a ${createdOffers.length} conductor(es) con TTL de ${ttlSeconds}s.`
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
        }
        return offer;
      });

    return requestOffers;
  }
}


