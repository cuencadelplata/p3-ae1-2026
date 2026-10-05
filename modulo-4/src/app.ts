import express from 'express';
import { apiReference } from '@scalar/express-api-reference';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LocationController } from './controllers/location.controller.js';
import { LocationService } from './services/location.service.js';
import { MemoryLocationRepository } from './repositories/memory-location.repository.js';
import { MemoryLocationHistoryRepository } from './repositories/memory-location-history.repository.js';

const ttlSeconds = Number(process.env.LOCATION_TTL_SECONDS ?? 60);
export const locationService = new LocationService(
  new MemoryLocationRepository(),
  ttlSeconds,
  Date.now,
  new MemoryLocationHistoryRepository()
);
const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectDirectory = path.resolve(moduleDirectory, '..');

export const createApp = (
  service: LocationService,
  checkStorage: () => Promise<void> = async () => undefined
) => {
const controller = new LocationController(service);
const application = express();
application.use(express.json());
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
    health: '/health',
    documentation: '/docs'
  });
});

application.get('/health', async (_req, res) => {
  try {
    await checkStorage();
    res.status(200).json({ status: 'ok', service: 'm4-location-service', storage: 'ok' });
  } catch {
    res.status(503).json({ status: 'error', service: 'm4-location-service', storage: 'unavailable' });
  }
});

application.put('/api/v1/drivers/:driverId/location', controller.updateLocation);
application.get('/api/v1/drivers/:driverId/location', controller.getLocation);
application.get('/api/v1/drivers/:driverId/location-history', controller.getLocationHistory);
application.delete('/api/v1/drivers/:driverId/location', controller.removeLocation);
application.patch('/api/v1/drivers/:driverId/availability', controller.updateAvailability);
application.get('/api/v1/drivers/nearby', controller.findNearby);
application.post('/api/v1/geocode', controller.geocode);
application.post('/api/v1/estimate', controller.estimate);
return application;
};

export const app = createApp(locationService);
