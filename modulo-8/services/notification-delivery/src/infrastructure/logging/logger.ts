export interface DeliveryLogPayload {
  level?: 'INFO' | 'WARN' | 'ERROR';
  event: string;
  messageId: string;
  notificationId?: string;
  userId?: string;
  correlationId?: string;
  tripId?: string;
  attempt?: number;
  result?: string;
  latencyMs?: number;
  error?: string;
}

export class StructuredLogger {
  static log(payload: DeliveryLogPayload): void {
    const logEntry = {
      timestamp: new Date().toISOString(),
      service: 'notification-delivery',
      level: payload.level ?? 'INFO',
      event: payload.event,
      messageId: payload.messageId,
      notificationId: payload.notificationId,
      userId: payload.userId,
      correlationId: payload.correlationId,
      tripId: payload.tripId,
      attempt: payload.attempt,
      result: payload.result,
      latencyMs: payload.latencyMs,
      error: payload.error,
    };

    // Imprimir estrictamente JSON estructurado
    console.log(JSON.stringify(logEntry));
  }

  static info(payload: Omit<DeliveryLogPayload, 'level'>): void {
    this.log({ ...payload, level: 'INFO' });
  }

  static warn(payload: Omit<DeliveryLogPayload, 'level'>): void {
    this.log({ ...payload, level: 'WARN' });
  }

  static error(payload: Omit<DeliveryLogPayload, 'level'>): void {
    this.log({ ...payload, level: 'ERROR' });
  }
}
