import express from 'express';
import cors from 'cors';
import { apiReference } from '@scalar/express-api-reference';
import { openApiSpec } from './docs/openapi.js';
import { customerController } from './controllers/customer.controller.js';
import { accountStatusController } from './controllers/account-status.controller.js';
import { tripsController } from './controllers/trips.controller.js';
import { asyncHandler } from './middlewares/async-handler.js';
import { errorHandler } from './middlewares/error-handler.js';
import { requireAuth, requireAuthOrServiceKey } from './middlewares/auth.middleware.js';
import { metricsHandler, httpMetricsMiddleware } from './observability/metrics.js';
import { healthHandler, registerHealthCheck } from './health/registry.js';
import { checkM6, checkSoporte } from './health/external-checks.js';
import { mountStubs } from './stubs/index.js';
import { soporteStubRouter } from './stubs/soporte.stub.js';
import { m6StubRouter } from './stubs/m6.stub.js';

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
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Secret-Key'],
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
// M6 y Soporte caídos degradan el servicio (200 DEGRADED) pero no lo dejan fuera: solo Postgres es crítico
registerHealthCheck('soporte', checkSoporte, { critical: false });
registerHealthCheck('m6', checkM6, { critical: false });
app.get('/metrics', metricsHandler);

// 3. Stubs de módulos externos (solo si STUBS_ENABLED=true).
// M1 lo monta mountStubs por defecto; soporte y m6 (de Leandro) se pasan como adicionales.
mountStubs(app, [
  { name: 'soporte', router: soporteStubRouter },
  { name: 'm6', router: m6StubRouter }
]);

// 4. Rutas de la API REST (/v1/customers...)
// RF-2.1 (Erwin): perfil de cliente, protegido con requireAuth
app.post('/v1/customers', requireAuth({ roles: ['CLIENTE'] }), asyncHandler(customerController.createCustomer));
app.get('/v1/customers/me', requireAuth(), asyncHandler(customerController.getMe));
app.get('/v1/customers', (req, res, next) => {
  // El listado es abierto, salvo cuando se filtra por userId (uso de M8): ahí exige token
  if (req.query.userId) {
    requireAuth()(req, res, next);
  } else {
    next();
  }
}, asyncHandler(customerController.listCustomers));
app.get('/v1/customers/:id', requireAuth(), asyncHandler(customerController.getCustomerById));
app.put('/v1/customers/:id', requireAuth(), asyncHandler(customerController.updateCustomerPreferences));

// RF-2.5: Estado de cuenta (Leandro)
// GET /status acepta token de usuario (solo el dueño) o X-Secret-Key (otros módulos).
// PUT /status exige token de usuario y solo lo permite el dueño.
app.get('/v1/customers/:id/status', requireAuthOrServiceKey(), asyncHandler(accountStatusController.getAccountStatus));
app.put('/v1/customers/:id/status', requireAuth(), asyncHandler(accountStatusController.updateAccountStatus));

// RF-2.3: Historial de viajes (Leandro) — requiere token de usuario (se reenvía a M6)
app.get('/v1/customers/:id/trips', requireAuth(), asyncHandler(tripsController.getCustomerTrips));

// 5. Manejador 404 para rutas no reconocidas
app.use((_req, res) => {
  res.status(404).json({
    error: 'NotFound',
    message: 'La ruta solicitada no existe en el microservicio de clientes'
  });
});

// 6. Middleware central de errores (debe registrarse al final)
app.use(errorHandler);
