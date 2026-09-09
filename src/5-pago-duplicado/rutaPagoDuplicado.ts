import { Router } from "express";
import { esPagoDuplicado } from "./verificaPagoDuplicado";
import { registrosDeEjemplo } from "../mock/registroPagoMock"; // mock compartido

const router = Router();

// GET /pagos/:idOrden/duplicado
// consulta si un pago con idOrden ya fue registrado, para evitar cobros duplicados
// registrados (mock), responde true/false

router.get("/pagos/:idOrden/duplicado", (req, res) => {
  const { idOrden } = req.params;
  const esDuplicado = esPagoDuplicado(idOrden, registrosDeEjemplo); // busca si ya existe
  res.json({ idOrden, esDuplicado });
});

export default router;