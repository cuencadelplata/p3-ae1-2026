import { randomUUID } from 'node:crypto';
import type { PushDeliveryProvider } from './push-delivery-provider.js';
import type { PushSendRequest, PushSendResult } from '../../domain/delivery.types.js';

export type SandboxMode = 'NORMAL' | 'FAIL_TEMPORARY' | 'FAIL_ALWAYS' | 'SLOW';

export interface SandboxConfig {
  mode?: SandboxMode;
  failuresBeforeSuccess?: number;
  simulatedDelayMs?: number;
}

export class SandboxPushProvider implements PushDeliveryProvider {
  private mode: SandboxMode;
  private failuresBeforeSuccess: number;
  private currentFailureCount: number = 0;
  private simulatedDelayMs: number;
  private sentPushes: PushSendRequest[] = [];

  constructor(config: SandboxConfig = {}) {
    this.mode = config.mode ?? 'NORMAL';
    this.failuresBeforeSuccess = config.failuresBeforeSuccess ?? 2;
    this.simulatedDelayMs = config.simulatedDelayMs ?? 10;
  }

  setMode(mode: SandboxMode, failuresBeforeSuccess: number = 2): void {
    this.mode = mode;
    this.failuresBeforeSuccess = failuresBeforeSuccess;
    this.currentFailureCount = 0;
  }

  getSentPushes(): readonly PushSendRequest[] {
    return this.sentPushes;
  }

  clearHistory(): void {
    this.sentPushes = [];
    this.currentFailureCount = 0;
  }

  async sendPush(request: PushSendRequest): Promise<PushSendResult> {
    const startTime = Date.now();

    if (this.simulatedDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.simulatedDelayMs));
    }

    this.sentPushes.push({ ...request });

    if (this.mode === 'FAIL_ALWAYS') {
      const latencyMs = Date.now() - startTime;
      return {
        success: false,
        statusCode: 503,
        latencyMs,
        error: 'Push Sandbox: Servicio de notificaciones externas no disponible (503 Service Unavailable)',
      };
    }

    if (this.mode === 'FAIL_TEMPORARY') {
      if (this.currentFailureCount < this.failuresBeforeSuccess) {
        this.currentFailureCount += 1;
        const latencyMs = Date.now() - startTime;
        return {
          success: false,
          statusCode: 504,
          latencyMs,
          error: `Push Sandbox: Error transitorio de gateway (Intento fallido ${this.currentFailureCount} de ${this.failuresBeforeSuccess})`,
        };
      }
    }

    const latencyMs = Date.now() - startTime;
    const providerMessageId = `sandbox-fcm-${randomUUID()}`;

    return {
      success: true,
      providerMessageId,
      statusCode: 200,
      latencyMs,
    };
  }
}
