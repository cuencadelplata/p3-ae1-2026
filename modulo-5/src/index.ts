import express from 'express';
import path from 'path';
import { RideRequestService } from './services/ride-request.service';
import { RideRequestController } from './controllers/ride-request.controller';

const app = express();
const PORT = process.env.PORT || 3005;

app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));
app.use('/openapi', express.static(path.join(__dirname, '../openapi')));

// Inyección de dependencias
const rideRequestService = new RideRequestService();
const rideRequestController = new RideRequestController(rideRequestService);

// Health check (RNF-16)
app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'UP', service: 'm5-dispatch-service', timestamp: new Date() });
});

// Rutas API v1
app.post('/api/v1/ride-requests', rideRequestController.create);
app.get('/api/v1/ride-requests/:requestId', rideRequestController.getById);
app.patch('/api/v1/ride-requests/:requestId/cancel', rideRequestController.cancel);

if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`[M5 Solicitud y Despacho] Servicio ejecutándose en http://localhost:${PORT}`);
    console.log(`[M5] OpenAPI spec disponible en /openapi/openapi-m5.yaml`);
  });
}

export { app, rideRequestService };
