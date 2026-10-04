import { Router, Request, Response } from "express";

const router = Router();

// Simula la pasarela de pago de Mercado Pago
router.post("/mock-mercadopago/v1/payments", (req: Request, res: Response) => {
  const { viajeId, total } = req.body;

  if (!viajeId || typeof total !== "number") {
    res.status(400).json({ error: "viajeId y total son requeridos" });
    return;
  }

  res.status(201).json({
    id: `mp-mock-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    status: "approved",
    transaction_amount: total,
    viajeId,
  });
});

export default router;
