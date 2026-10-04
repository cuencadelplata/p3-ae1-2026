import express, { type Express, type IRouter } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { apiReference } from '@scalar/express-api-reference';
import { createSupportController, publicarEvento } from './controllers/support.controller.js';
import { correlationId } from './http/correlation.js';
import { supportErrorHandler } from './http/error-handler.js';
import type { SupportReadiness } from './http/readiness.js';
import type { TicketService } from './services/ticket.service.js';

export interface SupportAppDeps {
  ticketService: TicketService;
  // Expone POST /events/publish, heredado de AE1.
  legacyEvents: boolean;
  // Estado de las dependencias para /health/ready. Sin él la app no declara
  // dependencias externas y se informa lista.
  readiness?: () => Promise<SupportReadiness>;
}

// Rutas de tickets, relativas a /tickets.
const TICKET_ROUTES = [
  { method: 'post', path: '/', handler: 'crearTicket' },
  { method: 'get', path: '/:id', handler: 'obtenerTicket' },
  { method: 'patch', path: '/:id/estado', handler: 'actualizarEstado' },
  { method: 'get', path: '/:id/historial', handler: 'obtenerHistorial' },
  { method: 'get', path: '/', handler: 'listarTodos' },
] as const;

const LEGACY_EVENT_ROUTE = { method: 'post', path: '/events/publish' } as const;

// Rutas de la API que documenta el contrato OpenAPI (openapi/rf85-support.yaml).
// El test de contrato verifica que ambas listas coincidan.
export const SUPPORT_API_ROUTES: ReadonlyArray<{ method: string; path: string }> = [
  ...TICKET_ROUTES.map(({ method, path }) => ({ method, path: path === '/' ? '/tickets' : `/tickets${path}` })),
  LEGACY_EVENT_ROUTE,
];

// Endpoints RF-8.5 (Gestión de tickets de Soporte). Es lo único que necesita
// registrar una app común de M8: incluye su correlationId y su manejo de
// errores, acotados a /tickets.
export function registerSupportRoutes(router: IRouter, deps: SupportAppDeps) {
  const controller = createSupportController(deps);
  const tickets = express.Router();

  tickets.use(correlationId);
  for (const { method, path, handler } of TICKET_ROUTES) {
    tickets[method](path, controller[handler]);
  }
  tickets.use(supportErrorHandler);

  router.use('/tickets', tickets);
}

// Endpoint RF-8.6 / Pruebas de RabbitMQ (heredado de AE1)
export function registerLegacyEventRoutes(router: IRouter) {
  router[LEGACY_EVENT_ROUTE.method](LEGACY_EVENT_ROUTE.path, publicarEvento);
}

function loadOpenapi() {
  const openapiPath = [
    path.resolve(process.cwd(), 'openapi.yaml'),
    path.resolve(process.cwd(), '../../openapi/rf85-support.yaml'),
    path.resolve(process.cwd(), 'openapi/rf85-support.yaml'),
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
        'GET /health/live',
        'GET /health/ready',
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

  // Vitalidad: responde mientras el proceso esté vivo.
  app.get('/health/live', (req, res) => {
    res.status(200).json({ status: 'ok', service: 'm8-soporte' });
  });

  // Disponibilidad: agrega el estado de las dependencias. Estas dos rutas son
  // de la app standalone; una app común de M8 usa checkSupportReadiness().
  app.get('/health/ready', async (req, res) => {
    const readiness = deps.readiness ? await deps.readiness() : { status: 'ok' as const, checks: {} };
    res.status(readiness.status === 'unavailable' ? 503 : 200).json({ ...readiness, service: 'm8-soporte' });
  });

  registerSupportRoutes(app, deps);
  if (deps.legacyEvents) {
    registerLegacyEventRoutes(app);
  }

  // Errores fuera de /tickets, como un cuerpo JSON malformado.
  app.use(supportErrorHandler);

  return app;
}
