import { AsyncLocalStorage } from 'node:async_hooks';

export const correlationStorage = new AsyncLocalStorage<{ correlationId: string }>();

export class Logger {
  public static getCorrelationId(): string | undefined {
    return correlationStorage.getStore()?.correlationId;
  }

  public static info(message: string, context: Record<string, unknown> = {}): void {
    this.log('INFO', message, context);
  }

  public static warn(message: string, context: Record<string, unknown> = {}): void {
    this.log('WARN', message, context);
  }

  public static error(message: string, error?: unknown, context: Record<string, unknown> = {}): void {
    const errorDetails = error instanceof Error
      ? { name: error.name, message: error.message, stack: error.stack }
      : { rawError: String(error) };

    this.log('ERROR', message, { ...context, error: errorDetails });
  }

  private static log(level: 'INFO' | 'WARN' | 'ERROR', message: string, context: Record<string, unknown>): void {
    const logPayload = {
      timestamp: new Date().toISOString(),
      level,
      message,
      correlationId: this.getCorrelationId(),
      service: 'm4-location-service',
      ...context
    };

    const formattedJson = JSON.stringify(logPayload);
    if (level === 'ERROR') {
      console.error(formattedJson);
    } else if (level === 'WARN') {
      console.warn(formattedJson);
    } else {
      console.log(formattedJson);
    }
  }
}
