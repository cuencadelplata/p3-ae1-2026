import type { Request, Response } from 'express';
import { ZodError } from 'zod';
import {
  estimateSchema,
  geocodeSchema,
  nearbyQuerySchema,
  updateAvailabilitySchema,
  updateLocationSchema
} from '../schemas/location.schema.js';
import {
  LocationService,
  LocationValidationError,
  NotFoundError
} from '../services/location.service.js';

export class LocationController {
  public constructor(private readonly service: LocationService) {}

  public updateLocation = (req: Request, res: Response): void => {
    this.handle(res, () => {
      const body = updateLocationSchema.parse(req.body);
      return res.status(200).json(
        this.service.updateLocation(
          String(req.params.driverId),
          { latitude: body.latitude, longitude: body.longitude },
          body.vehicleType,
          body.available,
          body.timestamp
        )
      );
    });
  };

  public updateAvailability = (req: Request, res: Response): void => {
    this.handle(res, () => {
      const body = updateAvailabilitySchema.parse(req.body);
      return res.status(200).json(
        this.service.updateAvailability(String(req.params.driverId), body.available)
      );
    });
  };

  public getLocation = (req: Request, res: Response): void => {
    this.handle(res, () =>
      res.status(200).json(this.service.getActiveLocation(String(req.params.driverId)))
    );
  };

  public findNearby = (req: Request, res: Response): void => {
    this.handle(res, () => {
      const query = nearbyQuerySchema.parse(req.query);
      const drivers = this.service.findNearby(
        { latitude: query.latitude, longitude: query.longitude },
        query.vehicleType,
        query.radiusKm,
        query.limit
      );
      return res.status(200).json({ count: drivers.length, drivers });
    });
  };

  public geocode = (req: Request, res: Response): void => {
    this.handle(res, () => {
      const body = geocodeSchema.parse(req.body);
      return res.status(200).json(this.service.geocode(body.address));
    });
  };

  public estimate = (req: Request, res: Response): void => {
    this.handle(res, () => {
      const body = estimateSchema.parse(req.body);
      return res.status(200).json(this.service.estimate(body.origin, body.destination));
    });
  };

  private handle(res: Response, action: () => Response): void {
    try {
      action();
    } catch (error) {
      if (error instanceof ZodError) {
        res.status(400).json({
          code: 'VALIDATION_ERROR',
          message: 'Datos invalidos',
          details: error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        });
        return;
      }
      if (error instanceof LocationValidationError) {
        res.status(400).json({ code: 'LOCATION_VALIDATION_ERROR', message: error.message });
        return;
      }
      if (error instanceof NotFoundError) {
        res.status(404).json({ code: 'NOT_FOUND', message: error.message });
        return;
      }
      res.status(500).json({ code: 'INTERNAL_ERROR', message: 'Error interno del servicio' });
    }
  }
}
