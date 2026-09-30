export type LogLevel = 'info' | 'warn' | 'error';
export type Logger = (level: LogLevel, message: string, fields?: Record<string, unknown>) => void;

/** Log de una linea con el formato "[nombre] mensaje clave=valor ...". */
export function createLogger(name: string): Logger {
  return (level, message, fields = {}) => {
    const detail = Object.entries(fields)
      .map(([key, value]) => `${key}=${String(value)}`)
      .join(' ');
    console[level](`[${name}] ${message}${detail ? ` ${detail}` : ''}`);
  };
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
