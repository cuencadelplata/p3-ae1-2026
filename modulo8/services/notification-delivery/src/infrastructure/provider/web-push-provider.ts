import webpush, { WebPushError, type PushSubscription } from 'web-push';
import type { PushDeliveryProvider } from './push-delivery-provider.js';
import type { PushSendRequest, PushSendResult } from '../../domain/delivery.types.js';

export interface VapidConfig {
  publicKey?: string;
  privateKey?: string;
  subject?: string;
}

export function vapidConfigFromEnv(env: NodeJS.ProcessEnv = process.env): VapidConfig {
  return {
    publicKey: env.VAPID_PUBLIC_KEY?.trim() || undefined,
    privateKey: env.VAPID_PRIVATE_KEY?.trim() || undefined,
    subject: env.VAPID_SUBJECT?.trim() || undefined,
  };
}

/**
 * El token de un navegador es la suscripción Web Push serializada en JSON
 * (endpoint del servicio de push del navegador y claves de cifrado).
 */
export function parseWebPushSubscription(token: string): PushSubscription | null {
  try {
    const value = JSON.parse(token) as Partial<PushSubscription>;
    if (
      typeof value?.endpoint === 'string' && value.endpoint.startsWith('https://') &&
      typeof value.keys?.p256dh === 'string' && typeof value.keys?.auth === 'string'
    ) {
      return { endpoint: value.endpoint, keys: { p256dh: value.keys.p256dh, auth: value.keys.auth } };
    }
  } catch {
    // No es JSON: no es una suscripción de navegador.
  }
  return null;
}

/**
 * Proveedor real de notificaciones push: envía por el protocolo Web Push
 * (RFC 8030) al servicio de push del navegador (FCM en Chrome y Edge,
 * Mozilla Push en Firefox), firmado con las claves VAPID de M8.
 *
 * Solo entrega a navegadores. Un token que no es una suscripción Web Push no
 * tiene proveedor y falla sin reintentos.
 */
export class WebPushProvider implements PushDeliveryProvider {
  private readonly configured: boolean;

  constructor(private readonly config: VapidConfig = vapidConfigFromEnv()) {
    this.configured = Boolean(config.publicKey && config.privateKey && config.subject);
    if (this.configured) {
      webpush.setVapidDetails(config.subject!, config.publicKey!, config.privateKey!);
    }
  }

  isConfigured(): boolean {
    return this.configured;
  }

  publicKey(): string | undefined {
    return this.config.publicKey;
  }

  async sendPush(request: PushSendRequest): Promise<PushSendResult> {
    const startTime = Date.now();
    const elapsed = () => Date.now() - startTime;

    if (!this.configured) {
      return {
        success: false,
        statusCode: 503,
        latencyMs: elapsed(),
        isTransient: false,
        error: 'Web Push sin configurar: faltan VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY o VAPID_SUBJECT.',
      };
    }

    const subscription = parseWebPushSubscription(request.deviceToken);
    if (!subscription) {
      return {
        success: false,
        statusCode: 422,
        latencyMs: elapsed(),
        isTransient: false,
        error: 'El dispositivo no es una suscripción Web Push: M8 solo entrega notificaciones a navegadores.',
      };
    }

    const payload = JSON.stringify({
      title: request.title,
      body: request.body,
      tripId: request.tripId,
      notificationId: request.notificationId,
    });

    try {
      const response = await webpush.sendNotification(subscription, payload, {
        TTL: 3600,
        urgency: request.priority === 'HIGH' ? 'high' : 'normal',
        timeout: 5000,
      });
      return {
        success: true,
        statusCode: response.statusCode,
        latencyMs: elapsed(),
        providerMessageId: response.headers?.location ?? `web-push-${response.statusCode}`,
      };
    } catch (error) {
      if (error instanceof WebPushError) {
        // 404/410: la suscripción ya no existe (el usuario la revocó o venció).
        const gone = error.statusCode === 404 || error.statusCode === 410;
        return {
          success: false,
          statusCode: error.statusCode,
          latencyMs: elapsed(),
          isTransient: !gone && (error.statusCode === 429 || error.statusCode >= 500),
          error: gone
            ? 'La suscripción del navegador ya no es válida.'
            : `El servicio de push respondió ${error.statusCode}: ${error.body || error.message}`,
        };
      }
      return {
        success: false,
        statusCode: 503,
        latencyMs: elapsed(),
        isTransient: true,
        error: `No se pudo contactar al servicio de push: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
}
