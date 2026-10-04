import { Request, Response } from "express";
import { registrarMetodoPago, buscarPagoPorViaje, autorizarPago, rechazarPago } from "./procesoPago";
import { procesarPagoMercadoPago } from "./PagoCliente";

export function crearMetodoPago(req: Request, res: Response) {
  try {
    const { clienteId, viajeId, tipo } = req.body;

    const metodoPago = registrarMetodoPago(clienteId, viajeId, tipo);
    res.status(201).json(metodoPago);
  } catch (error) {
    res.status(400).json({
      mensaje: "No se pudo registrar el método de pago",
      error: (error as Error).message,
    });
  }
}

export function obtenerMetodoPago(req: Request, res: Response) {
  try {
    const viajeId = String(req.params.viajeId);
    const metodoPago = buscarPagoPorViaje(viajeId);

    if (!metodoPago) {
      res.status(404).json({
        mensaje: "No se encontró un pago para ese viaje",
      });
      return;
    }
    res.status(200).json(metodoPago);
  } catch (error) {
    res.status(400).json({
      mensaje: "No se pudo buscar el método de pago",
    });
  }
}

export async function autorizarMetodoPago(req: Request, res: Response) {
  try {
    const viajeId = String(req.params.viajeId);
    const { idOrden, total } = req.body;

    const montoTotal = typeof total === "number" ? total : 1000;

    const resultadoPago = await procesarPagoMercadoPago(viajeId, montoTotal);

    if (resultadoPago.status !== "approved") {
      res.status(402).json({ mensaje: "El pago fue rechazado por Mercado Pago" });
      return;
    }

    const metodoPago = autorizarPago(viajeId, idOrden ?? `ord_${Date.now()}`, resultadoPago.paymentId);
    res.status(200).json(metodoPago);
  } catch (error) {
    res.status(400).json({
      mensaje: "No se pudo autorizar el pago",
      error: (error as Error).message,
    });
  }
}

export function rechazarMetodoPago(req: Request, res: Response) {
  try {
    const viajeId = String(req.params.viajeId);
    const metodoPago = rechazarPago(viajeId);
    res.status(200).json(metodoPago);
  } catch (error) {
    res.status(400).json({
      mensaje: "No se pudo rechazar el pago",
      error: (error as Error).message,
    });
  }
}
