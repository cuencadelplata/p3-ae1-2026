import express from "express";

import { mockPushProvider } from "./notifications/mock-push-provider";
import { createProcessNotificationController } from "./notifications/notification.controller";
import type { PushProvider } from "./notifications/push-provider";
import { errorHandler } from "./shared/error-handler";

export function createApp(pushProvider: PushProvider) {
  const app = express();

  app.use(express.json());
  app.post("/notifications", createProcessNotificationController(pushProvider));
  app.use(errorHandler);

  return app;
}

export const app = createApp(mockPushProvider);
