import { Request, Response } from "express";
import { registrarMetodoPago, buscarPagoPorViaje, autorizarPago, rechazarPago } from "./procesoPago";
import { procesarPagoMercadoPago } from "./PagoCliente";

export async function crearMetodoPago(req: Request, res: Response) {
  try {
    const { clienteId, viajeId, tipo } = req.body;

    const metodoPago = await registrarMetodoPago(clienteId, viajeId, tipo);
    res.status(201).json(metodoPago);
  } catch (error) {
    res.status(400).json({
      mensaje: "No se pudo registrar el método de pago",
      error: (error as Error).message,
    });
  }
}

export async function obtenerMetodoPago(req: Request, res: Response) {
  try {
    const viajeId = String(req.params.viajeId);
    const metodoPago = await buscarPagoPorViaje(viajeId);

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
    const { idOrden, total, moneda } = req.body;

    if (!idOrden) {
      res.status(400).json({ mensaje: "idOrden es requerido" });
      return;
    }
    if (typeof total !== "number") {
      res.status(400).json({ mensaje: "total es requerido" });
      return;
    }

    const resultadoPago = await procesarPagoMercadoPago(viajeId, total);

    if (resultadoPago.status !== "approved") {
      res.status(402).json({ mensaje: "El pago fue rechazado por Mercado Pago" });
      return;
    }

    const metodoPago = await autorizarPago(viajeId, idOrden, {
      paymentId: resultadoPago.paymentId,
      total,
      moneda: moneda ?? "ARS",
    });

    res.status(200).json(metodoPago);
  } catch (error) {
    res.status(400).json({
      mensaje: "No se pudo autorizar el pago",
      error: (error as Error).message,
    });
  }
}

export async function rechazarMetodoPago(req: Request, res: Response) {
  try {
    const viajeId = String(req.params.viajeId);
    const metodoPago = await rechazarPago(viajeId);
    res.status(200).json(metodoPago);
  } catch (error) {
    res.status(400).json({
      mensaje: "No se pudo rechazar el pago",
      error: (error as Error).message,
    });
  }
}
