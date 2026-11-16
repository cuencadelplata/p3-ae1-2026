import { Router, Request, Response } from "express";
import { calculoReintegro } from "./calculoReintegro";
import { ejecutarReintegroMP } from "./reintegroMP";
import { supabase } from "../../supabaseClient";

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
  await supabase.from("reintegros").upsert(
    {
      id_orden: idOrden,
      viaje_id: viajeId,
      monto_cancelacion: montoCancelacion,
      monto_reintegro: montoReintegro,
    },
    { onConflict: "id_orden" }
  );

  res.status(200).json({ viajeId, montoCancelacion: Number(montoCancelacion), montoReintegro, refundId });
});

export default router;