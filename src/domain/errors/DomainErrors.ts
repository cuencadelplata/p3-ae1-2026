/**
 * Base abstract class for all Domain-level errors.
 */
export abstract class DomainError extends Error {
  public abstract readonly code: string;

  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class InvalidRatingScoreError extends DomainError {
  public readonly code = "INVALID_RATING_SCORE";

  constructor(score: number) {
    super(`El puntaje de calificación debe ser un número entero entre 1 y 5. Valor recibido: ${score}`);
  }
}

export class InvalidCommentError extends DomainError {
  public readonly code = "INVALID_COMMENT";

  constructor(maxLength: number, actualLength: number) {
    super(`El comentario excede la longitud máxima permitida de ${maxLength} caracteres. Longitud actual: ${actualLength}`);
  }
}

export class InvalidUuidError extends DomainError {
  public readonly code = "INVALID_UUID";

  constructor(fieldName: string, value: string) {
    super(`El campo '${fieldName}' debe ser un UUID v4 válido. Valor recibido: '${value}'`);
  }
}

export class DuplicateTripRatingError extends DomainError {
  public readonly code = "DUPLICATE_TRIP_RATING";

  constructor(tripId: string, customerId: string) {
    super(`El cliente '${customerId}' ya ha emitido una calificación previa para el viaje '${tripId}'.`);
  }
}

export class CustomerNotFoundError extends DomainError {
  public readonly code = "CUSTOMER_NOT_FOUND";

  constructor(customerId: string) {
    super(`No se encontró el cliente con ID: '${customerId}' en CustomerDB.`);
  }
}

export class CustomerInactiveError extends DomainError {
  public readonly code = "CUSTOMER_INACTIVE";

  constructor(customerId: string) {
    super(`El cliente con ID '${customerId}' se encuentra inactivo y no puede registrar calificaciones.`);
  }
}

export class InvalidTripProofError extends DomainError {
  public readonly code = "INVALID_TRIP_PROOF";

  constructor(reason: string) {
    super(`La prueba de viaje completado (TripCompletionProof) es inválida: ${reason}`);
  }
}
