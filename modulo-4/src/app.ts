import express from 'express';
import { apiReference } from '@scalar/express-api-reference';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LocationController } from './controllers/location.controller.js';
import { LocationService } from './services/location.service.js';

const ttlSeconds = Number(process.env.LOCATION_TTL_SECONDS ?? 60);
export const locationService = new LocationService(ttlSeconds);
const controller = new LocationController(locationService);
const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectDirectory = path.resolve(moduleDirectory, '..');

export const app = express();
app.use(express.json());
app.use('/openapi', express.static(path.join(projectDirectory, 'openapi')));
app.get('/scalar/standalone.js', (_req, res) => {
  res.sendFile(
    path.join(projectDirectory, 'node_modules', '@scalar', 'api-reference', 'dist', 'browser', 'standalone.js')
  );
});
app.use(express.static(path.join(projectDirectory, 'public')));

app.get(
  '/docs',
  apiReference({
    pageTitle: 'M4 - Documentacion API',
    theme: 'saturn',
    url: '/openapi/openapi-m4.yaml',
    cdn: '/scalar/standalone.js'
  })
);

app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok', service: 'm4-location-service' });
});

app.put('/api/v1/drivers/:driverId/location', controller.updateLocation);
app.get('/api/v1/drivers/:driverId/location', controller.getLocation);
app.delete('/api/v1/drivers/:driverId/location', controller.removeLocation);
app.patch('/api/v1/drivers/:driverId/availability', controller.updateAvailability);
app.get('/api/v1/drivers/nearby', controller.findNearby);
app.post('/api/v1/geocode', controller.geocode);
app.post('/api/v1/estimate', controller.estimate);
