import express from 'express';
import cors from 'cors';
import { apiReference } from '@scalar/express-api-reference';
import { openApiSpec } from './docs/openapi.js';
import { customerController } from './controllers/customer.controller.js';

export const app = express();

// Middlewares globales
app.use(cors({
  origin: [
    'http://localhost:5173', // Vite dev server
    'http://localhost:80',   // nginx local
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
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

// 3. Rutas de la API REST (/v1/customers...)
app.post('/v1/customers', customerController.createCustomer);
app.get('/v1/customers', customerController.listCustomers);
app.get('/v1/customers/:id', customerController.getCustomerById);
app.put('/v1/customers/:id', customerController.updateCustomerPreferences);
app.get('/v1/customers/:id/status', customerController.getAccountStatus);
app.get('/v1/customers/:id/trips', customerController.getCustomerTrips);

// 4. Manejador 404 para rutas no reconocidas
app.use((_req, res) => {
  res.status(404).json({
    error: 'NotFound',
    message: 'La ruta solicitada no existe en el microservicio de clientes'
  });
});
