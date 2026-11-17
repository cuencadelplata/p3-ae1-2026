import { AppError } from './app.error.js';

const STATUS_CODES: Record<number, { statusCode: number; code: string }> = {
  400: { statusCode: 400, code: 'SERVICIO_EXTERNO_DATOS_INVALIDOS' },
  401: { statusCode: 401, code: 'SERVICIO_EXTERNO_NO_AUTENTICADO' },
  403: { statusCode: 403, code: 'SERVICIO_EXTERNO_NO_AUTORIZADO' },
  404: { statusCode: 404, code: 'SERVICIO_EXTERNO_RECURSO_NO_ENCONTRADO' },
  409: { statusCode: 409, code: 'SERVICIO_EXTERNO_CONFLICTO' },
  422: { statusCode: 422, code: 'SERVICIO_EXTERNO_RECHAZO_NEGOCIO' },
  503: { statusCode: 503, code: 'SERVICIO_EXTERNO_NO_DISPONIBLE' },
};

export class ExternalServiceError extends AppError {
  public constructor(
    public readonly service: string,
    public readonly kind:
      | 'VALIDATION'
      | 'AUTHENTICATION'
      | 'AUTHORIZATION'
      | 'NOT_FOUND'
      | 'CONFLICT'
      | 'BUSINESS_REJECTION'
      | 'TIMEOUT'
      | 'UNAVAILABLE'
      | 'BAD_RESPONSE',
    statusCode: number,
    code: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(statusCode, code, message, options);
    this.name = 'ExternalServiceError';
  }

  public static fromHttpStatus(service: string, status: number): ExternalServiceError {
    const mapped = STATUS_CODES[status] ?? {
      statusCode: status >= 500 ? 503 : 502,
      code:
        status >= 500 ? 'SERVICIO_EXTERNO_NO_DISPONIBLE' : 'SERVICIO_EXTERNO_RESPUESTA_INVALIDA',
    };
    const kinds: Record<number, ExternalServiceError['kind']> = {
      400: 'VALIDATION',
      401: 'AUTHENTICATION',
      403: 'AUTHORIZATION',
      404: 'NOT_FOUND',
      409: 'CONFLICT',
      422: 'BUSINESS_REJECTION',
      503: 'UNAVAILABLE',
    };
    return new ExternalServiceError(
      service,
      kinds[status] ?? (status >= 500 ? 'UNAVAILABLE' : 'BAD_RESPONSE'),
      mapped.statusCode,
      mapped.code,
      `${service} rechazó la operación solicitada.`,
    );
  }

  public static timeout(service: string, cause?: unknown): ExternalServiceError {
    return new ExternalServiceError(
      service,
      'TIMEOUT',
      504,
      'SERVICIO_EXTERNO_TIMEOUT',
      `${service} no respondió dentro del tiempo permitido.`,
      cause === undefined ? undefined : { cause },
    );
  }

  public static unavailable(service: string, cause?: unknown): ExternalServiceError {
    return new ExternalServiceError(
      service,
      'UNAVAILABLE',
      503,
      'SERVICIO_EXTERNO_NO_DISPONIBLE',
      `${service} no está disponible.`,
      cause === undefined ? undefined : { cause },
    );
  }

  public static badResponse(service: string, cause?: unknown): ExternalServiceError {
    return new ExternalServiceError(
      service,
      'BAD_RESPONSE',
      502,
      'SERVICIO_EXTERNO_RESPUESTA_INVALIDA',
      `${service} devolvió una respuesta inválida.`,
      cause === undefined ? undefined : { cause },
    );
  }
}
