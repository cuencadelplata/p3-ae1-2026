import express, { type Express } from "express";
import path from "node:path";

import { mockPushProvider } from "./notifications/mock-push-provider";
import { createProcessNotificationController } from "./notifications/notification.controller";
import type { PushProvider } from "./notifications/push-provider";
import { errorHandler } from "./shared/error-handler";

const publicDirectory = path.join(__dirname, "..", "public");
const swaggerUiDirectory = path.dirname(require.resolve("swagger-ui-dist/package.json"));

export function createApp(pushProvider: PushProvider = mockPushProvider): Express {

  const app = express();

  app.use(express.json());
  app.use(express.static(publicDirectory));
  app.use("/api-docs-assets", express.static(swaggerUiDirectory));
  app.get("/health", (_request, response) => {
    response.status(200).json({ status: "ok", service: "m8" });
  });
  app.get("/openapi.yaml", (_request, response) => {
    response.sendFile(path.join(__dirname, "..", "docs", "api", "openapi.yaml"));
  });
  app.get(/^\/api-docs$/, (_request, response) => {
    response.redirect(302, "/api-docs/");
  });
  app.get("/api-docs/", (_request, response) => {
    response.sendFile(path.join(publicDirectory, "api-docs.html"));
  });
  app.post("/notifications", createProcessNotificationController(pushProvider));
  app.use(errorHandler);

  return app;
}

export const app = createApp();
