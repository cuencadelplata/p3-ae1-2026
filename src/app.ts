import express from "express";
import path from "node:path";

import { mockPushProvider } from "./notifications/mock-push-provider";
import { createProcessNotificationController } from "./notifications/notification.controller";
import type { PushProvider } from "./notifications/push-provider";
import { errorHandler } from "./shared/error-handler";

export function createApp(pushProvider: PushProvider) {
  const app = express();

  app.use(express.json());
  app.use(express.static(path.join(__dirname, "..", "public")));
  app.get("/openapi.yaml", (_request, response) => {
    response.sendFile(path.join(__dirname, "..", "docs", "api", "openapi.yaml"));
  });
  app.post("/notifications", createProcessNotificationController(pushProvider));
  app.use(errorHandler);

  return app;
}

export const app = createApp(mockPushProvider);
