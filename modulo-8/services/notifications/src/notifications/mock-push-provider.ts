import type { PushNotificationPayload, PushProvider } from "./push-provider";

export const mockPushProvider: PushProvider = {
  async send(_payload: PushNotificationPayload): Promise<void> { },
};

// es una implementacion concreta de PushProvide, cumple con el contrato PushProvider
// pero su implementacion es "Mock"
// no hace nada mas que validar que reciba los parametros correctos
// simula el envio de una push notification sin hacer nada real.
