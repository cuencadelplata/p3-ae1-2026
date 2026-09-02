// Error de conflicto: el dato que se quiere crear ya existe
// (ej: una patente duplicada). Se traduce a status 409.
export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConflictError";
  }
}