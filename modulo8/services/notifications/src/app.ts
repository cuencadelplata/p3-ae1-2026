import express, { Router, type Express } from "express";

import { errorHandler } from "./http/error-handler";
import { createProcessNotificationController } from "./notifications/notification.controller";
import type { PushProvider } from "./notifications/push-provider";

/**
 * POST /notifications es la entrada HTTP heredada. Solo procesa si se le pasa
 * un proveedor push; sin él responde 410 porque los avisos llegan por eventos
 * RabbitMQ y la entrega real la hace RF-8.7.
 */
export function createNotificationsRouter(pushProvider?: PushProvider): Router {
  const router = Router();
  if (pushProvider) {
    router.use(express.json());
    router.post("/notifications", createProcessNotificationController(pushProvider));
  } else {
    router.post("/notifications", (_request, response) => {
      response.status(410).json({ error: {
        code: "LEGACY_NOTIFICATION_DISABLED",
        message: "La notificación se procesa mediante eventos RabbitMQ.",
      } });
    });
  }
  router.use(errorHandler);
  return router;
}

export function createApp(pushProvider?: PushProvider): Express {
  const app = express();
  app.get("/health", (_request, response) => {
    response.status(200).json({ status: "ok", service: "m8" });
  });
  app.use(createNotificationsRouter(pushProvider));
  return app;
}
