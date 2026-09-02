// Error de "no existe": se pidió un recurso (ej: un vehículo)
// que no está en la base. Se traduce a status 404.
export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}