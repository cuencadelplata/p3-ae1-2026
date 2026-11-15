import { Router, Request, Response } from "express";
import { calculoReintegro } from "./calculoReintegro";

const router = Router();

// POST /reintegro
// RF-7.6: Calcula el reintegro correspondiente a una cancelación
router.post("/reintegro", (req: Request, res: Response) => {
  const { montoCancelacion, viajeId } = req.body;

  if (typeof montoCancelacion !== "number" || montoCancelacion < 0 || !viajeId) {
    return res.status(400).json({ error: "Datos inválidos o faltantes" });
  }

  const monto = Math.round(calculoReintegro(montoCancelacion) * 100) / 100;
  return res.status(200).json({
    monto,
    viajeId,
  });
});

export default router;
