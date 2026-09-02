import { Router, type Request, type Response } from 'express';
import path from 'node:path';
import swaggerUi from 'swagger-ui-express';
import YAML from 'yamljs';

export const docsRouter = Router();

// Carga la especificacion OpenAPI buscando en distintas rutas posibles
import fs from 'node:fs';

const candidatePaths = [
  path.resolve(__dirname, '../openapi/openapi.yaml'),
  path.resolve(__dirname, '../../src/openapi/openapi.yaml'),
  path.resolve(process.cwd(), 'src/openapi/openapi.yaml'),
  path.resolve(process.cwd(), 'dist/openapi/openapi.yaml'),
];

const openapiPath = candidatePaths.find((p) => fs.existsSync(p)) ?? candidatePaths[0]!;
let openapiDocument: Record<string, unknown>;

try {
  if (fs.existsSync(openapiPath)) {
    openapiDocument = YAML.load(openapiPath);
  } else {
    throw new Error(`No se encontro openapi.yaml en ninguna de las rutas esperadas: ${candidatePaths.join(', ')}`);
  }
} catch (error) {
  console.error('Error al cargar la especificacion OpenAPI:', error);
  openapiDocument = {
    openapi: '3.0.3',
    info: { title: 'M8 Comprobantes', version: '1.0.0' },
    paths: {},
  };
}

// Endpoint para descargar la definicion en formato JSON
docsRouter.get('/openapi.json', (_req: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/json');
  res.json(openapiDocument);
});

// Endpoint para descargar la definicion en formato YAML
docsRouter.get('/openapi.yaml', (_req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/yaml');
  res.sendFile(openapiPath);
});

// Swagger UI interactivo
docsRouter.use('/', swaggerUi.serve, swaggerUi.setup(openapiDocument, {
  customSiteTitle: 'M8 - Documentación OpenAPI (Comprobantes PDF)',
  customCss: '.swagger-ui .topbar { display: block; }',
}));
