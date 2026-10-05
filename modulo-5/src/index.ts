import express from 'express';
import path from 'path';
import { RideRequestService } from './services/ride-request.service';
import { RideRequestController } from './controllers/ride-request.controller';
import { RedisService } from './services/redis.service';
import { RabbitMQService } from './services/rabbitmq.service';
import { requireAuth, requireConductor } from './middleware/auth.middleware';

const app = express();
const PORT = process.env.PORT || 3005;

app.use(express.json());

// Middleware CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, Idempotency-Key');
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
    return;
  }
  next();
});

app.use(express.static(path.join(__dirname, '../public')));
app.use('/openapi', express.static(path.join(__dirname, '../openapi')));

// Inyección de dependencias
const redisService = new RedisService();
const rabbitmqService = new RabbitMQService();
const rideRequestService = new RideRequestService(redisService, rabbitmqService);
const rideRequestController = new RideRequestController(rideRequestService);

if (process.env.NODE_ENV !== 'test') {
  redisService.init().catch(() => {});
  rabbitmqService.init().catch(() => {});
}

// Health check con diagnóstico de dependencias (RNF-16)
app.get('/health', async (_req, res) => {
  const [redisOk, rabbitOk] = await Promise.all([
    redisService.isHealthy(),
    rabbitmqService.isHealthy()
  ]);
  res.status(200).json({
    status: 'UP',
    service: 'm5-dispatch-service',
    timestamp: new Date().toISOString(),
    dependencies: {
      redis: redisOk ? 'CONNECTED' : 'DEGRADED_FALLBACK',
      rabbitmq: rabbitOk ? 'CONNECTED' : 'DEGRADED_FALLBACK'
    }
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

// Rutas API v1 - Solicitudes de Viaje (requieren usuario autenticado con M1)
app.post('/api/v1/ride-requests', requireAuth, rideRequestController.create);
app.get('/api/v1/ride-requests/:requestId', requireAuth, rideRequestController.getById);
app.post('/api/v1/ride-requests/:requestId/cancel', requireAuth, rideRequestController.cancel);
app.post('/api/v1/ride-requests/:requestId/candidates', requireAuth, rideRequestController.searchCandidates);
app.post('/api/v1/ride-requests/:requestId/offers', requireAuth, rideRequestController.sendOffers);
app.get('/api/v1/ride-requests/:requestId/offers', requireAuth, rideRequestController.getOffers);

// Alias de compatibilidad e interoperabilidad para clientes que consultan viajes por ID
app.get('/viajes/:requestId', rideRequestController.getById);
app.get('/api/v1/viajes/:requestId', rideRequestController.getById);

// Rutas API v1 - Gestión de Ofertas de Conductor (requieren role=CONDUCTOR validado por M1)
app.post('/api/v1/offers/:offerId/respond', requireConductor, rideRequestController.respondOffer);
app.post('/api/v1/offers/:offerId/accept', requireConductor, rideRequestController.acceptOffer);
app.post('/api/v1/offers/:offerId/reject', requireConductor, rideRequestController.rejectOffer);
app.get('/api/v1/offers/:offerId', requireAuth, rideRequestController.getOfferById);
app.get('/api/v1/offers', requireAuth, rideRequestController.getAllOffers);
app.get('/api/v1/drivers/:driverId/offers', requireConductor, rideRequestController.getOffersForDriver);

if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`[M5 Solicitud y Despacho] Servicio ejecutándose en http://localhost:${PORT}`);
    console.log(`[M5] Documentación Scalar interactiva en http://localhost:${PORT}/docs`);
    console.log(`[M5] OpenAPI spec disponible en /openapi/openapi-m5.yaml`);
  });
}

export { app, rideRequestService };
