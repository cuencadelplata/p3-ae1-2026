import type { PushNotificationPayload, PushProvider } from "./push-provider";

export const mockPushProvider: PushProvider = {
  async send(_payload: PushNotificationPayload): Promise<void> {},
};
