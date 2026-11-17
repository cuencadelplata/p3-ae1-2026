// Restricción UNIQUE de user_id en customers.CustomerProfile (nombre generado por PostgreSQL)
const USER_ID_UNIQUE_CONSTRAINT = 'customerprofile_user_id_key';
const UNIQUE_VIOLATION = '23505';

/**
 * Error de dominio: el usuario ya tiene un perfil de cliente.
 * El controlador lo traduce a 409 Conflict.
 */
export class CustomerAlreadyExistsError extends Error {
  constructor(message = 'El usuario ya tiene un perfil de cliente registrado') {
    super(message);
    this.name = 'CustomerAlreadyExistsError';
  }
}

// La DB es la única fuente de verdad: dos POST simultáneos del mismo usuario terminan acá
export function isDuplicateUserIdError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const { code, constraint } = error as { code?: unknown; constraint?: unknown };
  return code === UNIQUE_VIOLATION && constraint === USER_ID_UNIQUE_CONSTRAINT;
}
