import express from 'express';
import path from 'path';
import { RideRequestService } from './services/ride-request.service';
import { RideRequestController } from './controllers/ride-request.controller';

const app = express();
const PORT = process.env.PORT || 3005;

app.use(express.json());

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

// Health check (RNF-16)
app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'UP', service: 'm5-dispatch-service', timestamp: new Date() });
});

// Rutas API v1 - Solicitudes de Viaje
app.post('/api/v1/ride-requests', rideRequestController.create);
app.get('/api/v1/ride-requests/:requestId', rideRequestController.getById);
app.post('/api/v1/ride-requests/:requestId/cancel', rideRequestController.cancel);
app.post('/api/v1/ride-requests/:requestId/candidates', rideRequestController.searchCandidates);
app.post('/api/v1/ride-requests/:requestId/offers', rideRequestController.sendOffers);
app.get('/api/v1/ride-requests/:requestId/offers', rideRequestController.getOffers);

// Rutas API v1 - Gestión de Ofertas de Conductor (RF-5.4)
app.post('/api/v1/offers/:offerId/respond', rideRequestController.respondOffer);
app.post('/api/v1/offers/:offerId/accept', rideRequestController.acceptOffer);
app.post('/api/v1/offers/:offerId/reject', rideRequestController.rejectOffer);
app.get('/api/v1/offers/:offerId', rideRequestController.getOfferById);
app.get('/api/v1/offers', rideRequestController.getAllOffers);
app.get('/api/v1/drivers/:driverId/offers', rideRequestController.getOffersForDriver);



if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`[M5 Solicitud y Despacho] Servicio ejecutándose en http://localhost:${PORT}`);
    console.log(`[M5] OpenAPI spec disponible en /openapi/openapi-m5.yaml`);
  });
}

export { app, rideRequestService };
