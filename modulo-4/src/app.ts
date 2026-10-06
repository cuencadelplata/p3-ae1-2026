import express, { type Application } from 'express';
import { apiReference } from '@scalar/express-api-reference';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { EstimateDistanceEtaUseCase } from './application/use-cases/estimate-distance-eta.usecase.js';
import { GeocodeAddressUseCase } from './application/use-cases/geocode-address.usecase.js';
import { GetLocationHistoryUseCase } from './application/use-cases/get-location-history.usecase.js';
import { SearchNearbyDriversUseCase } from './application/use-cases/search-nearby-drivers.usecase.js';
import { UpdateLocationUseCase } from './application/use-cases/update-location.usecase.js';

import { config } from './infrastructure/config/env.config.js';
import { M1AuthAdapter } from './infrastructure/auth/m1-auth.adapter.js';
import { HttpGeocodingAdapter } from './infrastructure/geocoding/http-geocoding.adapter.js';
import { MockGeocodingAdapter } from './infrastructure/geocoding/mock-geocoding.adapter.js';
import { HealthController } from './infrastructure/http/controllers/health.controller.js';
import { LocationController } from './infrastructure/http/controllers/location.controller.js';
import { correlationMiddleware } from './infrastructure/http/middlewares/correlation.middleware.js';
import { errorHandlerMiddleware } from './infrastructure/http/middlewares/error.middleware.js';
import { MemoryLocationHistoryRepository } from './infrastructure/postgres/memory-location-history.repository.js';
import { PostgresLocationHistoryRepository } from './infrastructure/postgres/postgres-location-history.repository.js';
import { MemoryLocationRepository } from './infrastructure/redis/memory-location.repository.js';
import { RedisLocationRepository } from './infrastructure/redis/redis-location.repository.js';
import type { LocationHistoryRepository, LocationRepository } from './ports/location-repository.port.js';
import type { GeocodingProvider } from './ports/geocoding-provider.port.js';
import type { AuthService } from './ports/auth-service.port.js';
import type { EventPublisher } from './ports/event-publisher.port.js';
import type { RabbitMQConnection } from './infrastructure/rabbitmq/rabbitmq.connection.js';

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectDirectory = path.resolve(moduleDirectory, '..');

export interface AppDependencies {
  locationRepository?: LocationRepository;
  historyRepository?: LocationHistoryRepository;
  geocodingProvider?: GeocodingProvider;
  authService?: AuthService;
  eventPublisher?: EventPublisher;
  rabbitmqConnection?: RabbitMQConnection;
}

export const defaultMemoryRepository = new MemoryLocationRepository();
export const locationService = defaultMemoryRepository;

export const createApp = (dependencies: AppDependencies = {}): Application => {
  const application = express();
  application.use(express.json());
  application.use(correlationMiddleware);

  // Instanciación de Adaptadores
  const repository: LocationRepository =
    dependencies.locationRepository ||
    (config.redisUrl && process.env.NODE_ENV !== 'test'
      ? new RedisLocationRepository(config.redisUrl, config.redisKeyPrefix)
      : defaultMemoryRepository);

  const historyRepo: LocationHistoryRepository =
    dependencies.historyRepository ||
    (config.postgresUrl && process.env.NODE_ENV !== 'test'
      ? new PostgresLocationHistoryRepository(config.postgresUrl)
      : new MemoryLocationHistoryRepository());

  const geocoder: GeocodingProvider =
    dependencies.geocodingProvider ||
    (config.useMockGeocoding
      ? new MockGeocodingAdapter()
      : new HttpGeocodingAdapter(config.geocodingProviderUrl, config.geocodingApiKey, config.geocodingTimeoutMs));

  const auth: AuthService =
    dependencies.authService || new M1AuthAdapter(config.m1Url, config.skipAuthValidation);

  // Casos de Uso
  const updateLocationUseCase = new UpdateLocationUseCase(repository, historyRepo, config.locationTtlSeconds);
  const getLocationHistoryUseCase = new GetLocationHistoryUseCase(historyRepo);
  const searchNearbyDriversUseCase = new SearchNearbyDriversUseCase(repository);
  const geocodeAddressUseCase = new GeocodeAddressUseCase(geocoder);
  const estimateDistanceEtaUseCase = new EstimateDistanceEtaUseCase();

  // Controladores
  const healthController = new HealthController(repository, dependencies.rabbitmqConnection);
  const locationController = new LocationController(
    repository,
    updateLocationUseCase,
    searchNearbyDriversUseCase,
    geocodeAddressUseCase,
    estimateDistanceEtaUseCase,
    getLocationHistoryUseCase,
    auth,
    dependencies.eventPublisher
  );

  // Documentación OpenAPI / Scalar
  application.use('/openapi', express.static(path.join(projectDirectory, 'openapi')));
  application.get('/scalar/standalone.js', (_req, res) => {
    res.sendFile(
      path.join(projectDirectory, 'node_modules', '@scalar', 'api-reference', 'dist', 'browser', 'standalone.js')
    );
  });
  application.get(
    '/docs',
    apiReference({
      pageTitle: 'M4 - Documentacion API',
      theme: 'saturn',
      url: '/openapi/openapi-m4.yaml',
      cdn: '/scalar/standalone.js'
    })
  );

  application.get('/', (_req, res) => {
    res.status(200).json({
      service: 'm4-location-service',
      version: '2.0.0',
      liveness: '/health/liveness',
      readiness: '/health/readiness',
      documentation: '/docs'
    });
  });

  // Endpoints de Salud (RNF-05)
  application.get('/health/liveness', healthController.getLiveness);
  application.get('/health/readiness', healthController.getReadiness);
  application.get('/health', healthController.getReadiness);

  // Endpoints de la API
  application.put('/api/v1/drivers/:driverId/location', locationController.updateLocation);
  application.get('/api/v1/drivers/:driverId/location', locationController.getLocation);
  application.get('/api/v1/drivers/:driverId/location-history', locationController.getLocationHistory);
  application.delete('/api/v1/drivers/:driverId/location', locationController.removeLocation);
  application.patch('/api/v1/drivers/:driverId/availability', locationController.updateAvailability);
  application.get('/api/v1/drivers/nearby', locationController.findNearby);
  application.post('/api/v1/geocode', locationController.geocode);
  application.post('/api/v1/estimate', locationController.estimate);

  // Middleware de Manejo de Errores Global
  application.use(errorHandlerMiddleware);

  return application;
};

export const app = createApp();
