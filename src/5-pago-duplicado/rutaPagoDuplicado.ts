import { Router } from "express";
import { existeOrden } from "../6-reintegro/reintegroBD";
import { estaEnCache, marcarEnCache } from "../infraestructura/redis";

const router = Router();

// GET /pagos/:idOrden/duplicado
// consulta si una orden ya fue procesada: primero en Redis (rápido), si no en la base (fuente de verdad)
router.get("/pagos/:idOrden/duplicado", async (req, res) => {
  const { idOrden } = req.params;
  try {
    const esDuplicado = (await estaEnCache(idOrden)) || (await existeOrden(idOrden));
    if (esDuplicado) await marcarEnCache(idOrden); // solo cacheamos el "sí"; un "no" puede cambiar
    res.json({ idOrden, esDuplicado });
  } catch {
    res.status(503).json({ error: "No se pudo consultar el registro de órdenes" });
  }
});

export default router;