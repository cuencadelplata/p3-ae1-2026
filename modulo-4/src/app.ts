import express from 'express';
import { LocationController } from './controllers/location.controller.js';
import { LocationService } from './services/location.service.js';

const ttlSeconds = Number(process.env.LOCATION_TTL_SECONDS ?? 60);
export const locationService = new LocationService(ttlSeconds);
const controller = new LocationController(locationService);

export const app = express();
app.use(express.json());
app.use('/openapi', express.static('openapi'));

app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok', service: 'm4-location-service' });
});

app.put('/api/v1/drivers/:driverId/location', controller.updateLocation);
app.get('/api/v1/drivers/:driverId/location', controller.getLocation);
app.patch('/api/v1/drivers/:driverId/availability', controller.updateAvailability);
app.get('/api/v1/drivers/nearby', controller.findNearby);
app.post('/api/v1/geocode', controller.geocode);
app.post('/api/v1/estimate', controller.estimate);
