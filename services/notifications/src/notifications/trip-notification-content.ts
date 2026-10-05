import type { TripNotificationEventType } from "./notification.types";

export interface TripNotificationContent {
  title: string;
  message: string;
}

const contentByEventType: Record<TripNotificationEventType, TripNotificationContent> = {
  TripRequested: {
    title: "Solicitud de viaje recibida",
    message: "Tu solicitud de viaje fue recibida.",
  },
  TripAssigned: {
    title: "Conductor asignado",
    message: "Se asignó un conductor a tu viaje.",
  },
  DriverArrived: {
    title: "Tu conductor llegó",
    message: "Tu conductor ha llegado al punto de encuentro.",
  },
  TripStarted: {
    title: "Tu viaje comenzó",
    message: "Tu viaje ha comenzado.",
  },
  TripCancelled: {
    title: "Viaje cancelado",
    message: "Tu viaje fue cancelado.",
  },
  TripCompleted: {
    title: "Viaje finalizado",
    message: "Tu viaje ha finalizado.",
  },
};

export function getTripNotificationContent(
  eventType: TripNotificationEventType,
): TripNotificationContent {
  return contentByEventType[eventType];
}
