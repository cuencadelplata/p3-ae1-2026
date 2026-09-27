import express, { type Express } from "express";

import { errorHandler } from "./http/error-handler";
import { registerQrRoutes } from "./qr.controller";

export function createApp(): Express {
  const app = express();

  app.use(express.json());
  app.get("/health", (_request, response) => {
    response.status(200).json({ status: "ok", service: "qr" });
  });
  registerQrRoutes(app);
  app.use(errorHandler);

  return app;
}

export const app = createApp();
