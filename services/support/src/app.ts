import express, { type Express, type IRouter } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { apiReference } from '@scalar/express-api-reference';
import { createSupportController, publicarEvento } from './controllers/support.controller.js';
import { correlationId } from './http/correlation.js';
import { supportErrorHandler } from './http/error-handler.js';
import type { TicketService } from './services/ticket.service.js';

export interface SupportAppDeps {
  ticketService: TicketService;
  // Expone POST /events/publish, heredado de AE1.
  legacyEvents: boolean;
}

// Endpoints RF-8.5 (Gestión de tickets de Soporte). Es lo único que necesita
// registrar una app común de M8: incluye su correlationId y su manejo de
// errores, acotados a /tickets.
export function registerSupportRoutes(router: IRouter, deps: SupportAppDeps) {
  const controller = createSupportController(deps);
  const tickets = express.Router();

  tickets.use(correlationId);
  tickets.post('/', controller.crearTicket);
  tickets.get('/:id', controller.obtenerTicket);
  tickets.patch('/:id/estado', controller.actualizarEstado);
  tickets.get('/:id/historial', controller.obtenerHistorial);
  tickets.get('/', controller.listarTodos);
  tickets.use(supportErrorHandler);

  router.use('/tickets', tickets);
}

// Endpoint RF-8.6 / Pruebas de RabbitMQ (heredado de AE1)
export function registerLegacyEventRoutes(router: IRouter) {
  router.post('/events/publish', publicarEvento);
}

function loadOpenapi() {
  const openapiPath = [
    path.resolve(process.cwd(), 'openapi.yaml'),
    path.resolve(process.cwd(), '../../openapi/support.openapi.yaml'),
    path.resolve(process.cwd(), 'openapi/support.openapi.yaml'),
  ].find((candidate) => fs.existsSync(candidate));

  if (!openapiPath) {
    throw new Error('No se encontro el contrato OpenAPI canónico de Support.');
  }
  const fileContent = fs.readFileSync(openapiPath, 'utf8');
  return { fileContent, openapiDocument: YAML.parse(fileContent) };
}

// Aplicación HTTP de Support. Crearla no abre puertos ni conecta al broker:
// eso lo hace el entrypoint (index.ts).
export function createSupportApp(deps: SupportAppDeps): Express {
  const app = express();
  app.use(correlationId);
  app.use(express.json());

  // Configuración de Swagger (OpenAPI)
  const { fileContent, openapiDocument } = loadOpenapi();

  app.use('/api-docs', apiReference({
    pageTitle: 'M8 - Soporte API Reference',
    theme: 'purple',
    spec: { content: openapiDocument },
  }));

  // Servir la especificación OpenAPI en formato crudo (YAML y JSON)
  app.get('/openapi.yaml', (req, res) => {
    res.setHeader('Content-Type', 'text/yaml');
    res.send(fileContent);
  });

  app.get('/openapi.json', (req, res) => {
    res.json(openapiDocument);
  });

  // Ruta raíz (Estado del servicio)
  app.get('/', (req, res) => {
    res.json({
      servicio: 'M8 - Soporte, Notificaciones y RabbitMQ',
      estado: 'ACTIVO',
      documentacion: '/api-docs',
      health: '/health',
      endpoints: [
        'GET /health',
        'GET /openapi.yaml',
        'GET /openapi.json',
        'POST /tickets',
        'GET /tickets',
        'GET /tickets/:id',
        'PATCH /tickets/:id/estado',
        'GET /tickets/:id/historial',
        'POST /events/publish'
      ]
    });
  });

  // Endpoint de Health Check
  app.get('/health', (req, res) => {
    res.status(200).json({
      status: 'OK',
      service: 'm8-soporte',
      timestamp: new Date().toISOString(),
      uptime: process.uptime()
    });
  });

  registerSupportRoutes(app, deps);
  if (deps.legacyEvents) {
    registerLegacyEventRoutes(app);
  }

  // Errores fuera de /tickets, como un cuerpo JSON malformado.
  app.use(supportErrorHandler);

  return app;
}
