import { randomUUID } from "node:crypto";

import {
  HTTP_EVENT_TYPE_TO_TRIP_NOTIFICATION_EVENT_TYPE,
  NOTIFICATION_STATUSES,
  type Notification,
  type NotificationRequest,
} from "./notification.types";
import type { PushProvider } from "./push-provider";
import { getTripNotificationContent } from "./trip-notification-content";

export async function processNotification(
  request: NotificationRequest,
  pushProvider: PushProvider,
): Promise<Notification> {
  const tripEventType = HTTP_EVENT_TYPE_TO_TRIP_NOTIFICATION_EVENT_TYPE[request.eventType];
  const { message } = getTripNotificationContent(tripEventType);
  const notificationId = randomUUID();
  const createdAt = new Date().toISOString();

  await pushProvider.send({
    recipientId: request.recipientId,
    message,
  });

  return {
    notificationId,
    tripId: request.tripId,
    recipientId: request.recipientId,
    eventType: request.eventType,
    channels: request.channels,
    message,
    status: NOTIFICATION_STATUSES[0],
    createdAt,
  };
}
