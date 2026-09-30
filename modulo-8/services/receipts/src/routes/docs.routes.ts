import { Router, type Request, type Response } from 'express';
import path from 'node:path';
import fs from 'node:fs';
import YAML from 'yamljs';
import { apiReference } from '@scalar/express-api-reference';

import { createLogger, errorFields } from '../observability/logger';

export const docsRouter = Router();

// Carga la especificacion OpenAPI buscando en distintas rutas posibles
const candidatePaths = [
  path.resolve(process.cwd(), 'openapi/receipts.openapi.yaml'),
  path.resolve(process.cwd(), '../../openapi/receipts.openapi.yaml'),
];

const openapiPath = candidatePaths.find((p) => fs.existsSync(p)) ?? candidatePaths[0]!;
let openapiDocument: Record<string, unknown>;

try {
  if (fs.existsSync(openapiPath)) {
    openapiDocument = YAML.load(openapiPath);
  } else {
    throw new Error(`No se encontro receipts.openapi.yaml en ninguna de las rutas esperadas: ${candidatePaths.join(', ')}`);
  }
} catch (error) {
  createLogger('docs')('error', 'no se pudo cargar la especificacion OpenAPI', errorFields(error));
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

// Scalar UI interactivo
docsRouter.use(
  '/',
  apiReference({
    theme: 'purple',
    pageTitle: 'M8 - Documentación OpenAPI (Comprobantes PDF)',
    spec: {
      content: openapiDocument,
    },
  }),
);
