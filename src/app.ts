import express from "express";

import { mockPushProvider } from "./notifications/mock-push-provider";
import { createProcessNotificationController } from "./notifications/notification.controller";
import { errorHandler } from "./shared/error-handler";

const app = express();

app.use(express.json());
app.post("/notifications", createProcessNotificationController(mockPushProvider));
app.use(errorHandler);

export { app };
