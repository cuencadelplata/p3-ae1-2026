import { Router } from "express";
import { existeOrden } from "../reintegro/reintegroBD";
import { estaEnCache, marcarEnCache } from "../infraestructura/redis";

const router = Router();

// GET /pagos/:idOrden/duplicado
// RF-7.5: Consulta si una orden ya fue procesada: primero en Redis (rápido con Circuit Breaker), si no en la base de datos PostgreSQL
router.get("/pagos/:idOrden/duplicado", async (req, res) => {
  const { idOrden } = req.params;
  try {
    const esDuplicado = (await estaEnCache(idOrden)) || (await existeOrden(idOrden));
    if (esDuplicado) await marcarEnCache(idOrden);
    res.json({ idOrden, esDuplicado });
  } catch {
    res.status(503).json({ error: "No se pudo consultar el registro de órdenes" });
  }
});

export default router;
