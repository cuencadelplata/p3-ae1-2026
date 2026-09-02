import { Router } from "express";
import { esPagoDuplicado } from "./verificaPagoDuplicado";
import { registrosDeEjemplo } from "../mock/registroPagoMock"; // mock compartido

const router = Router();

router.get("/pagos/:idOrden/duplicado", (req, res) => {
  const { idOrden } = req.params;
  const esDuplicado = esPagoDuplicado(idOrden, registrosDeEjemplo);
  res.json({ idOrden, esDuplicado });
});

export default router;