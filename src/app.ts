import express, { type Express } from "express";

import { errorHandler } from "./shared/error-handler";

type RegisterRoutes = (app: Express) => void;

export function createApp(registerRoutes?: RegisterRoutes): Express {
  const app = express();

  app.use(express.json());
  registerRoutes?.(app);
  app.use(errorHandler);

  return app;
}
