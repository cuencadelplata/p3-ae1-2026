import { Router } from "express";
import {
  crearMetodoPago,
  obtenerMetodoPago,
  autorizarMetodoPago,
  rechazarMetodoPago,
} from "./controllerPago";

const router = Router();

// RF-7.2: Registro de método de pago
router.post("/metodo-pago", crearMetodoPago);

// RF-7.2: Consulta de método de pago por viaje
router.get("/metodo-pago/:viajeId", obtenerMetodoPago);

// RF-7.3: Autorización del método de pago
router.post("/metodo-pago/:viajeId/autorizar", autorizarMetodoPago);

// RF-7.3: Rechazo del método de pago
router.post("/metodo-pago/:viajeId/rechazar", rechazarMetodoPago);

export default router;
