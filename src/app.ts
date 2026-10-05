import express from 'express';
import cors from 'cors';
import { apiReference } from '@scalar/express-api-reference';
import { openApiSpec } from './docs/openapi.js';
import { customerController } from './controllers/customer.controller.js';
import { accountStatusController } from './controllers/account-status.controller.js';
import { tripsController } from './controllers/trips.controller.js';
import { asyncHandler } from './middlewares/async-handler.js';
import { errorHandler } from './middlewares/error-handler.js';
import { mountStubs } from './stubs/index.js';

export const app = express();

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

// 2. Healthcheck del servicio
app.get('/health', (_req, res) => {
  res.json({
    status: 'UP',
    service: 'm2-clientes-api',
    docs: '/docs'
  });
});

// 3a. Stubs de módulos externos (solo si STUBS_ENABLED=true)
mountStubs(app);

// 3b. Rutas de la API REST (/v1/customers...)
// RF-2.1: asyncHandler envía los errores async al middleware central (Express 4 no lo hace solo)
app.post('/v1/customers', asyncHandler(customerController.createCustomer));
app.get('/v1/customers', asyncHandler(customerController.listCustomers));
app.get('/v1/customers/:id', asyncHandler(customerController.getCustomerById));
app.put('/v1/customers/:id', asyncHandler(customerController.updateCustomerPreferences));

// RF-2.5: Estado de cuenta (Leandro) — asyncHandler evita que un error async cuelgue el request
app.get('/v1/customers/:id/status', asyncHandler(accountStatusController.getAccountStatus));
app.put('/v1/customers/:id/status', asyncHandler(accountStatusController.updateAccountStatus));

// RF-2.3: Historial de viajes (Leandro) — asyncHandler igual
app.get('/v1/customers/:id/trips', asyncHandler(tripsController.getCustomerTrips));

// 4. Manejador 404 para rutas no reconocidas
app.use((_req, res) => {
  res.status(404).json({
    error: 'NotFound',
    message: 'La ruta solicitada no existe en el microservicio de clientes'
  });
});

// 5. Middleware central de errores (debe registrarse al final)
app.use(errorHandler);
