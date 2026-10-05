export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export class DuplicateCalificacionError extends Error {
  constructor(viajeId: string) {
    super(`El viaje ${viajeId} ya ha sido calificado previamente`);
    this.name = 'DuplicateCalificacionError';
  }
}

export class ForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ForbiddenError';
  }
}

export class InvalidTripStateError extends Error {
  constructor(estadoActual: string) {
    super(`El viaje debe estar en estado 'completado' para ser calificado. Estado actual: '${estadoActual}'`);
    this.name = 'InvalidTripStateError';
  }
}
