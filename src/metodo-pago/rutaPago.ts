import { Router } from "express";

import { crearMetodoPago, obtenerMetodoPago} from "./controllerPago";

const router = Router();

// POST /metodo-pago
router.post("/metodo-pago", crearMetodoPago);

// GET /metodo-pago/:viajeId
router.get("/metodo-pago/:viajeId", obtenerMetodoPago);

export default router;