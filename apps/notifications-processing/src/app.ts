import express, { type Express } from "express";

import { errorHandler } from "./http/error-handler";
import { mockPushProvider } from "./notifications/mock-push-provider";
import { createProcessNotificationController } from "./notifications/notification.controller";
import type { PushProvider } from "./notifications/push-provider";

export function createApp(pushProvider: PushProvider = mockPushProvider): Express {
  const app = express();
  app.use(express.json());
  app.get("/health", (_request, response) => {
    response.status(200).json({ status: "ok", service: "m8" });
  });
  app.post("/notifications", createProcessNotificationController(pushProvider));
  app.use(errorHandler);
  return app;
}

export const app = createApp();
