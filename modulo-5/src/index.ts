import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import path from 'path';
import { RideRequestService } from './services/ride-request.service';
import { RideRequestController } from './controllers/ride-request.controller';
import { authenticate, requireAuth, requireConductor } from './middleware/auth.middleware';
import { TelemetryService } from './services/telemetry.service';

const app = express();
const PORT = process.env.PORT || 3005;

app.use(express.json());

// Middleware de Telemetría para medir latencia HTTP (ms) en tiempo real
app.use((req, res, next) => {
  if (!req.path.startsWith('/api/v1/')) {
    next();
    return;
  }
  const startNs = process.hrtime.bigint();
  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startNs) / 1_000_000;
    const normalizedRoute = req.route?.path || req.path.replace(/[0-9a-f-]{8,}/gi, ':id');
    TelemetryService.getInstance().recordHttpRequestDuration(
      Math.round(durationMs * 100) / 100,
      req.method,
      normalizedRoute,
      res.statusCode
    );
  });
  next();
});

// Middleware CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, Idempotency-Key, x-user-id, x-driver-id, x-client-id');
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
    return;
  }
  next();
});

app.use(express.static(path.join(__dirname, '../public')));
app.use('/openapi', express.static(path.join(__dirname, '../openapi')));

// Inyección de dependencias
const rideRequestService = new RideRequestService();
const rideRequestController = new RideRequestController(rideRequestService);
TelemetryService.getInstance();

// Sembrar conductores mock para el simulador interactivo y tests E2E locales cuando M4 no está levantado
rideRequestService.getM4ClientService().seedMockDrivers([
  {
    driverId: 'drv_101',
    latitude: -34.6037,
    longitude: -58.3816,
    distanceKm: 1.2,
    vehicleType: 'AUTO',
    available: true,
    rating: 4.9,
    expiresAt: '2099-12-31T23:59:59.000Z'
  },
  {
    driverId: 'drv_102',
    latitude: -34.5885,
    longitude: -58.3974,
    distanceKm: 2.1,
    vehicleType: 'AUTO',
    available: true,
    rating: 4.8,
    expiresAt: '2099-12-31T23:59:59.000Z'
  },
  {
    driverId: 'drv_103',
    latitude: -34.6037,
    longitude: -58.3816,
    distanceKm: 0.8,
    vehicleType: 'MOTO',
    available: true,
    rating: 5.0,
    expiresAt: '2099-12-31T23:59:59.000Z'
  }
]);

// Health check con diagnóstico de backing services (RNF-16 / AE2)
app.get('/health', (_req, res) => {
  const redisReady = rideRequestService.getRedisService().isReady();
  const rabbitmqReady = rideRequestService.getRabbitMQService().isReady();
  const dbReady = rideRequestService.getDbService().isReady();
  res.status(200).json({
    status: 'UP',
    service: 'm5-dispatch-service',
    version: '2.0.0',
    backingServices: {
      redis: redisReady ? 'CONNECTED' : 'FALLBACK_MEMORY',
      rabbitmq: rabbitmqReady ? 'CONNECTED' : 'FALLBACK_MEMORY',
      database: dbReady ? 'CONNECTED' : 'FALLBACK_MEMORY'
    },
    timestamp: new Date().toISOString()
  });
});

// Documentación de la API interactiva con Scalar
app.get(['/docs', '/reference'], (_req, res) => {
  res.send(`<!doctype html>
<html lang="es">
  <head>
    <title>Módulo 5: Solicitud y Despacho — Documentación Scalar</title>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <link rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>🚗</text></svg>">
  </head>
  <body>
    <script
      id="api-reference"
      data-url="/openapi/openapi-m5.yaml"
      data-configuration='{
        "theme": "purple",
        "darkMode": true,
        "layout": "modern",
        "showSidebar": true,
        "searchHotKey": "k",
        "metaData": {
          "title": "Módulo 5: Solicitud y Despacho - API Reference"
        }
      }'>
    </script>
    <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
  </body>
</html>`);
});


// Rutas API v1 - Solicitudes de Viaje
// RF-5.1 (crear y consultar) protegido con autenticación (RNF-10)
app.post('/api/v1/ride-requests', authenticate, rideRequestController.create);
app.get('/api/v1/ride-requests/:requestId', authenticate, rideRequestController.getById);
app.post('/api/v1/ride-requests/:requestId/cancel', authenticate, rideRequestController.cancel);
app.post('/api/v1/ride-requests/:requestId/cancel-assigned', rideRequestController.cancelAssigned);
app.delete('/api/v1/ride-requests/:requestId', authenticate, rideRequestController.cancel);
app.get('/api/v1/ride-requests/:requestId/audit', rideRequestController.getAuditLogs);
app.post('/api/v1/ride-requests/:requestId/candidates', rideRequestController.searchCandidates);
app.post('/api/v1/ride-requests/:requestId/offers', requireAuth, rideRequestController.sendOffers);
app.get('/api/v1/ride-requests/:requestId/offers', rideRequestController.getOffers);

// Alias de compatibilidad e interoperabilidad para clientes que consultan viajes por ID
app.get('/viajes/:requestId', authenticate, rideRequestController.getById);
app.get('/api/v1/viajes/:requestId', authenticate, rideRequestController.getById);
// Rutas API v1 - Gestión de Ofertas de Conductor (RF-5.4)
app.post('/api/v1/offers/:offerId/respond', requireConductor, rideRequestController.respondOffer);
app.post('/api/v1/offers/:offerId/accept', requireConductor, rideRequestController.acceptOffer);
app.post('/api/v1/offers/:offerId/reject', requireConductor, rideRequestController.rejectOffer);
app.get('/api/v1/offers/:offerId', rideRequestController.getOfferById);
app.get('/api/v1/offers', rideRequestController.getAllOffers);
app.get('/api/v1/drivers/:driverId/offers', requireConductor, rideRequestController.getOffersForDriver);



if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`[M5 Solicitud y Despacho] Servicio ejecutándose en http://localhost:${PORT}`);
    console.log(`[M5] Documentación Scalar interactiva en http://localhost:${PORT}/docs`);
    console.log(`[M5] OpenAPI spec disponible en /openapi/openapi-m5.yaml`);
  });
}


export { app, rideRequestService };
