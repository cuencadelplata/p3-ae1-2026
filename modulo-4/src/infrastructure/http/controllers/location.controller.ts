import type { NextFunction, Request, Response } from 'express';
import type { EstimateDistanceEtaUseCase } from '../../../application/use-cases/estimate-distance-eta.usecase.js';
import type { GeocodeAddressUseCase } from '../../../application/use-cases/geocode-address.usecase.js';
import type { SearchNearbyDriversUseCase } from '../../../application/use-cases/search-nearby-drivers.usecase.js';
import type { UpdateLocationUseCase } from '../../../application/use-cases/update-location.usecase.js';
import type { VehicleType } from '../../../domain/entities/location.entity.js';
import { LocationValidationError, NotFoundError } from '../../../domain/errors/location.errors.js';
import type { EventPublisher } from '../../../ports/event-publisher.port.js';
import type { LocationRepository } from '../../../ports/location-repository.port.js';

export class LocationController {
  public constructor(
    private readonly locationRepository: LocationRepository,
    private readonly updateLocationUseCase: UpdateLocationUseCase,
    private readonly searchNearbyDriversUseCase: SearchNearbyDriversUseCase,
    private readonly geocodeAddressUseCase: GeocodeAddressUseCase,
    private readonly estimateDistanceEtaUseCase: EstimateDistanceEtaUseCase,
    private readonly eventPublisher?: EventPublisher
  ) {}

  public updateLocation = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const driverId = String(req.params.driverId);
      const { latitude, longitude, vehicleType, available, timestamp } = req.body;

      if (typeof latitude !== 'number' || typeof longitude !== 'number') {
        throw new LocationValidationError('latitude y longitude deben ser valores numéricos válidos');
      }

      if (vehicleType !== 'AUTO' && vehicleType !== 'MOTO') {
        throw new LocationValidationError('vehicleType debe ser AUTO o MOTO');
      }

      if (available !== undefined && typeof available !== 'boolean') {
        throw new LocationValidationError('available debe ser un valor booleano');
      }

      const location = await this.updateLocationUseCase.execute({
        driverId,
        coordinates: { latitude, longitude },
        vehicleType: vehicleType as VehicleType,
        available: available ?? true,
        timestamp
      });

      res.status(200).json(location);
    } catch (error) {
      next(error);
    }
  };

  public getLocation = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const driverId = String(req.params.driverId);
      const location = await this.locationRepository.get(driverId);
      if (!location) {
        throw new NotFoundError(`Ubicación activa no encontrada para el conductor ${driverId}`);
      }
      res.status(200).json(location);
    } catch (error) {
      next(error);
    }
  };

  public removeLocation = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const driverId = String(req.params.driverId);
      const deleted = await this.locationRepository.delete(driverId);
      if (!deleted) {
        throw new NotFoundError(`Ubicación activa no encontrada para eliminar el conductor ${driverId}`);
      }
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  };

  public updateAvailability = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const driverId = String(req.params.driverId);
      const { available } = req.body;

      if (typeof available !== 'boolean') {
        throw new LocationValidationError('El campo disponible debe ser un valor booleano');
      }

      const currentLocation = await this.locationRepository.get(driverId);
      if (!currentLocation) {
        throw new NotFoundError(`Ubicación activa no encontrada para el conductor ${driverId}`);
      }

      const updated = {
        ...currentLocation,
        available,
        updatedAt: new Date().toISOString()
      };

      await this.locationRepository.saveIfNewer(updated, 60);

      if (this.eventPublisher) {
        await this.eventPublisher.publishDriverAvailabilityChanged({
          eventId: `avail-${driverId}-${Date.now()}`,
          driverId,
          available,
          timestamp: new Date().toISOString()
        });
      }

      res.status(200).json(updated);
    } catch (error) {
      next(error);
    }
  };

  public findNearby = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { latitude, longitude, vehicleType, radiusKm, limit, maxCandidates } = req.query;

      const lat = Number.parseFloat(String(latitude || ''));
      const lon = Number.parseFloat(String(longitude || ''));
      const radius = radiusKm ? Number.parseFloat(String(radiusKm)) : 5;
      const rawLimit = maxCandidates || limit;
      const maxLimit = rawLimit ? Number.parseInt(String(rawLimit), 10) : 10;

      if (Number.isNaN(lat) || Number.isNaN(lon)) {
        throw new LocationValidationError('Los parámetros latitude y longitude son obligatorios y deben ser números válidos');
      }

      if (vehicleType !== 'AUTO' && vehicleType !== 'MOTO') {
        throw new LocationValidationError('El parámetro vehicleType es obligatorio y debe ser AUTO o MOTO');
      }

      if (Number.isNaN(radius) || radius <= 0 || radius > 50) {
        throw new LocationValidationError('El parámetro radiusKm debe ser un número mayor a 0 y menor o igual a 50');
      }

      const results = await this.searchNearbyDriversUseCase.execute({
        origin: { latitude: lat, longitude: lon },
        vehicleType: vehicleType as VehicleType,
        radiusKm: radius,
        limit: maxLimit
      });

      res.status(200).json({
        vehicleType: String(vehicleType),
        searchRadiusKm: radius,
        candidatesCount: results.length,
        searchTimestamp: new Date().toISOString(),
        count: results.length,
        drivers: results
      });
    } catch (error) {
      next(error);
    }
  };

  public geocode = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { address } = req.body;
      if (!address || typeof address !== 'string') {
        throw new LocationValidationError('El campo address es obligatorio y debe ser una cadena de texto');
      }

      const geocoded = await this.geocodeAddressUseCase.execute(address);
      res.status(200).json(geocoded);
    } catch (error) {
      next(error);
    }
  };

  public estimate = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { origin, destination } = req.body;

      if (!origin || !destination) {
        throw new LocationValidationError('Los objetos origin y destination son obligatorios');
      }

      const estimateResult = this.estimateDistanceEtaUseCase.execute({
        origin,
        destination
      });

      res.status(200).json(estimateResult);
    } catch (error) {
      next(error);
    }
  };
}
