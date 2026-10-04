import type { LogicalNotification } from "./notification.types";

export interface SaveNotificationResult {
  notification: LogicalNotification;
  created: boolean;
}

export interface NotificationRepository {
  saveIdempotent(notification: LogicalNotification): Promise<SaveNotificationResult>;
}
