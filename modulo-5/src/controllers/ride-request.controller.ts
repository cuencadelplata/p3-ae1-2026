import { Request, Response } from 'express';
import {
  RideRequestService,
  ConflictError,
  NotFoundError,
  ValidationError
} from '../services/ride-request.service';
import { CreateRideRequestDTO } from '../types/ride-request.types';

export class RideRequestController {
  constructor(private readonly rideRequestService: RideRequestService) {}

  /**
   * Extrae el ID del cliente del contexto de seguridad (JWT / M1)
   */
  private extractClientId(req: Request): string {
    // En producción se obtiene de (req as any).user.sub proveniente del middleware JWT de M1
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return 'client_demo_default';
    }
    return req.headers['x-user-id']?.toString() || 'client_demo_default';
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
   * PATCH /api/v1/ride-requests/:requestId/cancel
   */
  public cancel = async (req: Request, res: Response): Promise<void> => {
    try {
      const { requestId } = req.params;
      const clientId = this.extractClientId(req);
      const reason = req.body?.reason;

      const updatedRequest = await this.rideRequestService.cancelRideRequest(
        requestId,
        clientId,
        reason
      );
      res.status(200).json(updatedRequest);
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
