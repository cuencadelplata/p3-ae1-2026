import { randomUUID } from "node:crypto";

import {
  NOTIFICATION_STATUSES,
  type EventType,
  type Notification,
  type NotificationRequest,
} from "./notification.types";
import type { PushProvider } from "./push-provider";

const messagesByEventType: Record<EventType, string> = {
  TRIP_REQUESTED: "Tu solicitud de viaje fue recibida.",
  DRIVER_ASSIGNED: "Se asignó un conductor a tu viaje.",
  DRIVER_ARRIVED: "Tu conductor ha llegado al punto de encuentro.",
  TRIP_STARTED: "Tu viaje ha comenzado.",
  TRIP_CANCELLED: "Tu viaje fue cancelado.",
  TRIP_COMPLETED: "Tu viaje ha finalizado.",
};

export async function processNotification(
  request: NotificationRequest,
  pushProvider: PushProvider,
): Promise<Notification> {
  const message = messagesByEventType[request.eventType];
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
