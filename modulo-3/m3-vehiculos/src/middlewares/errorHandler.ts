import type { Request, Response, NextFunction } from "express";
import { AppError } from "../errors/AppError.js";

export function errorHandler(err: unknown, req: Request, res: Response, next: NextFunction) {
  if (err instanceof AppError) {
    return res.status(err.status).json({ error: err.message });
  }

  console.error(err);
  res.status(500).json({ error: "Error interno del servidor" });
}