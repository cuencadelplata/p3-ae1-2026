import { Router } from "express";

const router = Router();

// Simula el endpoint real de Mercado Pago: POST /v1/payments
router.post("/mock-mercadopago/v1/payments", (req, res) => {
  const { viajeId, total } = req.body;

  if (!viajeId || typeof total !== "number") {
    res.status(400).json({ error: "viajeId y total son requeridos" });
    return;
  }

  res.status(201).json({
    id: `mp-mock-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    status: "approved",
    transaction_amount: total,
  });
});

export default router;