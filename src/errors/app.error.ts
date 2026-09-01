export class AppError extends Error {
  public constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'AppError';
  }
}

export const persistenceError = (cause?: unknown): AppError =>
  new AppError(
    500,
    'ERROR_PERSISTENCIA',
    'No fue posible completar la operación de persistencia.',
    { cause },
  );
