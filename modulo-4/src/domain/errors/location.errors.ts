export class NotFoundError extends Error {
  public constructor(message = 'Recurso no encontrado') {
    super(message);
    this.name = 'NotFoundError';
  }
}

export class LocationValidationError extends Error {
  public constructor(message = 'Error de validación de ubicación') {
    super(message);
    this.name = 'LocationValidationError';
  }
}

export class StaleLocationError extends Error {
  public constructor(message = 'Ubicación obsoleta') {
    super(message);
    this.name = 'StaleLocationError';
  }
}

export class GeocodingNotFoundError extends Error {
  public constructor(address: string) {
    super(`Dirección no encontrada por el geocodificador: ${address}`);
    this.name = 'GeocodingNotFoundError';
  }
}

export class GeocodingTimeoutError extends Error {
  public constructor(timeoutMs: number) {
    super(`Tiempo de espera agotado (${timeoutMs}ms) al consultar el servicio de geocodificación`);
    this.name = 'GeocodingTimeoutError';
  }
}

export class GeocodingProviderError extends Error {
  public constructor(message = 'Error en el proveedor externo de geocodificación') {
    super(message);
    this.name = 'GeocodingProviderError';
  }
}

export class InvalidCoordinatesError extends Error {
  public constructor(message = 'Las coordenadas especificadas están fuera de rango (-90 a 90 lat, -180 a 180 lon)') {
    super(message);
    this.name = 'InvalidCoordinatesError';
  }
}
