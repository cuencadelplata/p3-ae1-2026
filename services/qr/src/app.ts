import express, { type Express } from "express";

import { errorHandler } from "./http/error-handler";
import { registerQrRoutes } from "./qr.controller";
import type { QrService } from "./qr.service";

export interface AppDeps {
  readonly qrService: QrService;
}

// Solo compone la aplicación HTTP con las dependencias recibidas. El armado de esas
// dependencias ocurre en server.ts, para que importar este módulo no tenga efectos.
export function createApp(deps: AppDeps): Express {
  const app = express();

  app.use(express.json());
  app.get("/health", (_request, response) => {
    response.status(200).json({ status: "ok", service: "qr" });
  });
  registerQrRoutes(app, deps.qrService);
  app.use(errorHandler);

  return app;
}
