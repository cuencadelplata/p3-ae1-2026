import type { PushSendRequest, PushSendResult } from '../../domain/delivery.types.js';

export interface PushDeliveryProvider {
  sendPush(request: PushSendRequest): Promise<PushSendResult>;
}
