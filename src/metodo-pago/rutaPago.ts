import { Router } from "express";

import {
  crearMetodoPago,
  obtenerMetodoPago,
  autorizarMetodoPago,
  rechazarMetodoPago,
} from "./controllerPago";

const router = Router();

// POST /metodo-pago
router.post("/metodo-pago", crearMetodoPago);

// GET /metodo-pago/:viajeId
router.get("/metodo-pago/:viajeId", obtenerMetodoPago);

// POST /metodo-pago/:viajeId/autorizar
router.post("/metodo-pago/:viajeId/autorizar", autorizarMetodoPago);

// POST /metodo-pago/:viajeId/rechazar
router.post("/metodo-pago/:viajeId/rechazar", rechazarMetodoPago);

export default router;