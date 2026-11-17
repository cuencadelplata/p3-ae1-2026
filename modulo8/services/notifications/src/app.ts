import express, { Router, type Express } from "express";

import { errorHandler } from "./http/error-handler";
import { mockPushProvider } from "./notifications/mock-push-provider";
import { createProcessNotificationController } from "./notifications/notification.controller";
import type { PushProvider } from "./notifications/push-provider";

export function createNotificationsRouter(pushProvider: PushProvider = mockPushProvider, legacyHttpEnabled = true): Router {
  const router = Router();
  if (legacyHttpEnabled) {
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

export function createApp(pushProvider: PushProvider = mockPushProvider, legacyHttpEnabled = true): Express {
  const app = express();
  app.get("/health", (_request, response) => {
    response.status(200).json({ status: "ok", service: "m8" });
  });
  app.use(createNotificationsRouter(pushProvider, legacyHttpEnabled));
  return app;
}

export const app = createApp();
