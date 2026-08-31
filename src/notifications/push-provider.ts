export interface PushNotificationPayload {
  recipientId: string;
  message: string;
}

export interface PushProvider {
  send(payload: PushNotificationPayload): Promise<void>;
}
