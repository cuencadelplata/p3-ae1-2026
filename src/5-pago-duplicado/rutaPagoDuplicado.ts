import { Router } from "express";
import { esPagoDuplicado } from "./verificaPagoDuplicado";
import { registrosDeEjemplo } from "../mock/registroPagoMock"; // mock compartido

const router = Router();

router.get("/pagos/:ordenId/duplicado", (req, res) => {
  const { ordenId } = req.params;
  const esDuplicado = esPagoDuplicado(ordenId, registrosDeEjemplo);
  res.json({ ordenId, esDuplicado });
});

export default router;