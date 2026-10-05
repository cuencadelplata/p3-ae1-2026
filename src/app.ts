import express from 'express';
import cors from 'cors';
import { apiReference } from '@scalar/express-api-reference';
import { openApiSpec } from './docs/openapi.js';
import { customerController } from './controllers/customer.controller.js';
import { asyncHandler } from './middlewares/async-handler.js';
import { errorHandler } from './middlewares/error-handler.js';
import { requireAuth } from './middlewares/auth.middleware.js';
import { metricsHandler, httpMetricsMiddleware } from './observability/metrics.js';
import { healthHandler } from './health/registry.js';
import { mountStubs } from './stubs/index.js';

export const app = express();

// Metrics (before everything else)
app.use(httpMetricsMiddleware);

// Middlewares globales
app.use(cors({
  origin: [
    'http://localhost:5173', // Vite dev server
    'http://localhost:80',   // nginx local
  ],
  methods: ['GET', 'POST', 'PUT', 'OPTIONS'], // Sin DELETE: los clientes solo se dan de baja por estado
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(express.json());

// 1. Documentación Interactiva con Scalar (Exigido en SPECM5)
app.get('/openapi.json', (_req, res) => {
  res.json(openApiSpec);
});

app.use(
  '/docs',
  apiReference({
    spec: {
      content: openApiSpec
    },
    theme: 'purple',
    metaData: {
      title: 'Documentación de API - Clientes (Módulo 2)',
      description: 'API interactiva con Scalar para AE1'
    }
  })
);

// 2. Healthcheck y Métricas
app.get('/health', healthHandler);
app.get('/metrics', metricsHandler);

// 3. Stubs (Modo desarrollo/pruebas)
mountStubs(app);

// 4. Rutas de la API REST (/v1/customers...)
// RF-2.1: asyncHandler envía los errores async al middleware central (Express 4 no lo hace solo)
app.post('/v1/customers', requireAuth({ roles: ['CLIENTE'] }), asyncHandler(customerController.createCustomer));
app.get('/v1/customers/me', requireAuth(), asyncHandler(customerController.getMe));
app.get('/v1/customers', (req, res, next) => {
  if (req.query.userId) {
    requireAuth()(req, res, next);
  } else {
    next();
  }
}, asyncHandler(customerController.listCustomers));
app.get('/v1/customers/:id', requireAuth(), asyncHandler(customerController.getCustomerById));
app.put('/v1/customers/:id', requireAuth(), asyncHandler(customerController.updateCustomerPreferences));
app.get('/v1/customers/:id/status', customerController.getAccountStatus);
app.put('/v1/customers/:id/status', customerController.updateAccountStatus);
app.get('/v1/customers/:id/trips', customerController.getCustomerTrips);

// 5. Manejador 404 para rutas no reconocidas
app.use((_req, res) => {
  res.status(404).json({
    error: 'NotFound',
    message: 'La ruta solicitada no existe en el microservicio de clientes'
  });
});

// 5. Middleware central de errores (debe registrarse al final)
app.use(errorHandler);
