import { Router, Request, Response } from "express";
import { calculoReintegro } from "./calculoReintegro";
import { ejecutarReintegroMP } from "./reintegroMP";
import { insertarReintegro, existeViaje } from "./reintegroBD";

const router = Router();

router.post("/reintegro", async (req: Request, res: Response) => {
  const { montoCancelacion, viajeId, paymentId } = req.body;

  if (!montoCancelacion || !viajeId) {
    res.status(400).json({ error: "Faltan campos: montoCancelacion, viajeId" });
    return;
  }

  const montoReintegro =
    Math.round(calculoReintegro(Number(montoCancelacion)) * 100) / 100;

  let refundId: string | null = null;

  if (paymentId) {
    try {
      const resultado = await ejecutarReintegroMP(String(paymentId), montoReintegro);
      refundId = resultado.refundId;
    } catch (err: any) {
      res.status(502).json({
        error: "No se pudo procesar el reintegro en Mercado Pago",
        detalle: err?.message,
      });
      return;
    }
  }

  const idOrden = `${viajeId}-reintegro`;
  await insertarReintegro({
    idOrden,
    viajeId,
    montoCancelacion: Number(montoCancelacion),
    montoReintegro,
  });

  res.status(200).json({ viajeId, montoCancelacion: Number(montoCancelacion), montoReintegro, refundId });
});

router.get("/pagos/:viajeId/duplicado", async (req: Request, res: Response) => {
  const { viajeId } = req.params;
  const esDuplicado = await existeViaje(viajeId);
  res.status(200).json({ esDuplicado });
});

export default router;
