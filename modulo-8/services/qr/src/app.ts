import express, { type Express } from "express";

import { createHealthRouter, type DependencyCheck } from "./health";
import { errorHandler } from "./http/error-handler";
import { requestContext } from "./http/request-context";
import { registerQrRoutes } from "./qr.controller";
import type { QrService } from "./qr.service";

export interface AppDeps {
  readonly qrService: QrService;
  // Comprobación de disponibilidad de Redis para /health/ready.
  readonly checkRedis: DependencyCheck;
}

// Solo compone la aplicación HTTP con las dependencias recibidas. El armado de esas
// dependencias ocurre en server.ts, para que importar este módulo no tenga efectos.
export function createApp(deps: AppDeps): Express {
  const app = express();

  // Primero el contexto, para que también los errores de parseo del JSON lleven correlationId.
  app.use(requestContext);
  app.use(express.json());
  app.use(createHealthRouter(deps.checkRedis));
  registerQrRoutes(app, deps.qrService);
  app.use(errorHandler);

  return app;
}
