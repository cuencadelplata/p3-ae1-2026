import express, { Router, type Express } from "express";

import { errorHandler } from "./http/error-handler";
import { mockPushProvider } from "./notifications/mock-push-provider";
import { createProcessNotificationController } from "./notifications/notification.controller";
import type { PushProvider } from "./notifications/push-provider";

export function createNotificationsRouter(pushProvider: PushProvider = mockPushProvider): Router {
  const router = Router();
  router.use(express.json());
  router.post("/notifications", createProcessNotificationController(pushProvider));
  router.use(errorHandler);
  return router;
}

export function createApp(pushProvider: PushProvider = mockPushProvider): Express {
  const app = express();
  app.get("/health", (_request, response) => {
    response.status(200).json({ status: "ok", service: "m8" });
  });
  app.use(createNotificationsRouter(pushProvider));
  return app;
}

export const app = createApp();
