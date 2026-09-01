// Error de validación de negocio (datos inválidos que mandó el cliente).
// validarVehiculo/validarDocumento deberían tirar esto en vez de Error genérico.
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}