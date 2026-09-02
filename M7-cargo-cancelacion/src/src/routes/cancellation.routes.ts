import { Router, Request, Response } from "express";
import { calcularCargoCancelacion } from "../cancellationService";
import { CargoCancelacionRequest, DominioError } from "../types";

export const cancellationRouter = Router();

/**
 * POST /api/m7/cargo-cancelacion
 * RF-7.4 - Calcula un cargo de cancelacion cuando las reglas del viaje
 * lo indiquen.
 */
cancellationRouter.post("/cargo-cancelacion", (req: Request, res: Response) => {
  try {
    const body = req.body as CargoCancelacionRequest;
    const resultado = calcularCargoCancelacion(body);
    res.status(200).json(resultado);
  } catch (err) {
    if (err instanceof DominioError) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    console.error(err);
    res.status(500).json({ error: "Error interno al calcular el cargo de cancelacion" });
  }
});