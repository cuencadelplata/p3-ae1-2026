import { Request, Response } from 'express';
import {
  RideRequestService,
  ConflictError,
  NotFoundError,
  ValidationError
} from '../services/ride-request.service';
import { CreateRideRequestDTO, CancelRideRequestDTO } from '../types/ride-request.types';

export class RideRequestController {
  constructor(private readonly rideRequestService: RideRequestService) {}

  /**
   * Extrae el ID del cliente del contexto de seguridad (JWT / M1)
   */
  private extractClientId(req: Request): string {
    const customHeader = req.headers['x-user-id'] || req.headers['x-client-id'];
    if (customHeader) {
      return customHeader.toString();
    }
    return 'client_demo_default';
  }

  /**
   * POST /api/v1/ride-requests
   */
  public create = async (req: Request, res: Response): Promise<void> => {
    try {
      const idempotencyKey = req.headers['idempotency-key']?.toString();
      if (!idempotencyKey) {
        res.status(400).json({
          code: 'MISSING_IDEMPOTENCY_KEY',
          message: "El header 'Idempotency-Key' es obligatorio.",
          timestamp: new Date().toISOString()
        });
        return;
      }

      const clientId = this.extractClientId(req);
      const dto: CreateRideRequestDTO = req.body;

      const rideRequest = await this.rideRequestService.createRideRequest(
        clientId,
        idempotencyKey,
        dto
      );

      res.status(201).json(rideRequest);
    } catch (error) {
      this.handleError(res, error);
    }
  };

  /**
   * POST /api/v1/ride-requests/:requestId/cancel
   * Cancelación previa de solicitud por el cliente (RF-5.6)
   */
  public cancel = async (req: Request, res: Response): Promise<void> => {
    try {
      const { requestId } = req.params;
      const clientId = this.extractClientId(req);
      const dto: CancelRideRequestDTO = req.body || {};

      const result = await this.rideRequestService.cancelRideRequest(requestId, clientId, dto);
      res.status(200).json(result);
    } catch (error) {
      this.handleError(res, error);
    }
  };

  /**
   * GET /api/v1/ride-requests/:requestId
   */
  public getById = async (req: Request, res: Response): Promise<void> => {
    try {
      const { requestId } = req.params;
      const clientId = this.extractClientId(req);

      const rideRequest = await this.rideRequestService.getRideRequestById(requestId, clientId);
      res.status(200).json(rideRequest);
    } catch (error) {
      this.handleError(res, error);
    }
  };

  /**
   * POST /api/v1/ride-requests/:requestId/candidates
   * Búsqueda de candidatos para la solicitud (RF-5.2)
   */
  public searchCandidates = async (req: Request, res: Response): Promise<void> => {
    try {
      const { requestId } = req.params;
      const clientId = this.extractClientId(req);
      const { radiusKm, maxCandidates } = req.body || {};

      const candidatesResult = await this.rideRequestService.searchCandidatesForRequest(
        requestId,
        clientId,
        {
          radiusKm: radiusKm !== undefined ? Number(radiusKm) : undefined,
          maxCandidates: maxCandidates !== undefined ? Number(maxCandidates) : undefined
        }
      );

      res.status(200).json(candidatesResult);
    } catch (error) {
      this.handleError(res, error);
    }
  };

  /**
   * POST /api/v1/ride-requests/:requestId/offers
   * Enviar oferta con vencimiento (RF-5.3)
   */
  public sendOffers = async (req: Request, res: Response): Promise<void> => {
    try {
      const { requestId } = req.params;
      const clientId = this.extractClientId(req);
      const { driverIds, ttlSeconds } = req.body || {};

      const result = await this.rideRequestService.sendOffersForRequest(
        requestId,
        clientId,
        {
          driverIds: Array.isArray(driverIds) ? driverIds : undefined,
          ttlSeconds: ttlSeconds !== undefined ? Number(ttlSeconds) : undefined
        }
      );

      res.status(201).json(result);
    } catch (error) {
      this.handleError(res, error);
    }
  };

  /**
   * GET /api/v1/ride-requests/:requestId/offers
   * Consultar ofertas emitidas para la solicitud
   */
  public getOffers = async (req: Request, res: Response): Promise<void> => {
    try {
      const { requestId } = req.params;
      const clientId = this.extractClientId(req);

      const offers = await this.rideRequestService.getOffersByRequestId(requestId, clientId);
      res.status(200).json({ requestId, offersCount: offers.length, offers });
    } catch (error) {
      this.handleError(res, error);
    }
  };

  /**
   * Extrae el ID del conductor del contexto de seguridad (JWT / M1)
   */
  private extractDriverId(req: Request): string {
    const customHeader = req.headers['x-driver-id'] || req.headers['x-user-id'];
    if (customHeader) {
      return customHeader.toString();
    }
    if (req.body?.driverId) {
      return req.body.driverId.toString();
    }
    return 'driver_demo_default';
  }

  /**
   * POST /api/v1/offers/:offerId/respond
   * Aceptar o rechazar una oferta de viaje (RF-5.4)
   */
  public respondOffer = async (req: Request, res: Response): Promise<void> => {
    try {
      const { offerId } = req.params;
      const driverId = this.extractDriverId(req);
      const { action } = req.body || {};

      const result = await this.rideRequestService.respondToOffer(offerId, driverId, {
        action,
        driverId: req.body?.driverId
      });

      res.status(200).json(result);
    } catch (error) {
      this.handleError(res, error);
    }
  };

  /**
   * POST /api/v1/offers/:offerId/accept
   * Aceptar una oferta de viaje vigente (RF-5.4)
   */
  public acceptOffer = async (req: Request, res: Response): Promise<void> => {
    try {
      const { offerId } = req.params;
      const driverId = this.extractDriverId(req);

      const result = await this.rideRequestService.respondToOffer(offerId, driverId, {
        action: 'ACCEPT',
        driverId: req.body?.driverId
      });

      res.status(200).json(result);
    } catch (error) {
      this.handleError(res, error);
    }
  };

  /**
   * POST /api/v1/offers/:offerId/reject
   * Rechazar una oferta de viaje vigente (RF-5.4)
   */
  public rejectOffer = async (req: Request, res: Response): Promise<void> => {
    try {
      const { offerId } = req.params;
      const driverId = this.extractDriverId(req);

      const result = await this.rideRequestService.respondToOffer(offerId, driverId, {
        action: 'REJECT',
        driverId: req.body?.driverId
      });

      res.status(200).json(result);
    } catch (error) {
      this.handleError(res, error);
    }
  };

  /**
   * GET /api/v1/offers/:offerId
   * Consultar estado individual de una oferta
   */
  public getOfferById = async (req: Request, res: Response): Promise<void> => {
    try {
      const { offerId } = req.params;
      const offer = await this.rideRequestService.getOfferById(offerId);
      res.status(200).json(offer);
    } catch (error) {
      this.handleError(res, error);
    }
  };

  /**
   * GET /api/v1/drivers/:driverId/offers
   * Consulta todas las ofertas dirigidas a un conductor (RF-5.4)
   */
  public getOffersForDriver = async (req: Request, res: Response): Promise<void> => {
    try {
      const { driverId } = req.params;
      const offers = await this.rideRequestService.getOffersForDriver(driverId);
      res.status(200).json({ driverId, count: offers.length, offers });
    } catch (error) {
      this.handleError(res, error);
    }
  };

  /**
   * GET /api/v1/offers
   * Listado de todas las ofertas emitidas en el sistema
   */
  public getAllOffers = async (_req: Request, res: Response): Promise<void> => {
    try {
      const offers = await this.rideRequestService.getAllOffers();
      res.status(200).json({ count: offers.length, offers });
    } catch (error) {
      this.handleError(res, error);
    }
  };

  private handleError(res: Response, error: unknown): void {
    const timestamp = new Date().toISOString();

    if (error instanceof ValidationError) {
      res.status(400).json({
        code: error.code,
        message: error.message,
        details: error.details,
        timestamp
      });
      return;
    }

    if (error instanceof ConflictError) {
      const statusCode = error.code === 'FORBIDDEN_ACCESS' ? 403 : 409;
      res.status(statusCode).json({
        code: error.code,
        message: error.message,
        timestamp
      });
      return;
    }

    if (error instanceof NotFoundError) {
      res.status(404).json({
        code: error.code,
        message: error.message,
        timestamp
      });
      return;
    }

    res.status(500).json({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Ocurrió un error inesperado en el servicio de despacho.',
      timestamp
    });
  }
}
