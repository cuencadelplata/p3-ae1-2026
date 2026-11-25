import { Router } from "express";
import {
  crearMetodoPago,
  obtenerMetodoPago,
  autorizarMetodoPago,
  rechazarMetodoPago,
  reemplazarTarjetaRechazada,
} from "./controllerPago.js";
import { exigirApiKey } from "../../infraestructura/autenticacion.js";

const router = Router();

// RF-7.2: Registro de método de pago
router.post("/metodo-pago", exigirApiKey, crearMetodoPago);

// RF-7.2: Consulta de método de pago por viaje
router.get("/metodo-pago/:viajeId", exigirApiKey, obtenerMetodoPago);
router.patch("/metodo-pago/:viajeId", exigirApiKey, reemplazarTarjetaRechazada);

// RF-7.3: Autorización del método de pago
router.post("/metodo-pago/:viajeId/autorizar", exigirApiKey, autorizarMetodoPago);

// RF-7.3: Rechazo del método de pago
router.post("/metodo-pago/:viajeId/rechazar", exigirApiKey, rechazarMetodoPago);

export default router;
