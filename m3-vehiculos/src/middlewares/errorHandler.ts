import type { Request, Response, NextFunction } from "express";
import { ValidationError } from "../errors/validationError.js";

// Errores de dominio (validarVehiculo, validarDocumento, etc.) deben
// tirar ValidationError -> 400 (culpa del cliente).
// Cualquier otro error (Supabase caído, bug inesperado) -> 500.
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof ValidationError) {
    res.status(400).json({ error: err.message });
    return;
  }

  const message = err instanceof Error ? err.message : "Error desconocido";
  console.error(`[error] 500 - ${message}`);
  res.status(500).json({ error: "Error interno del servidor" });
}