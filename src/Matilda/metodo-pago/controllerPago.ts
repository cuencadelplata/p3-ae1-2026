import { redis, redisBreaker } from "../../infraestructura/redis";
import { Request, Response } from "express";
import { registrarMetodoPago, buscarPagoPorViaje, autorizarPago, rechazarPago } from "./procesoPago";
import { procesarPagoMercadoPago } from "./PagoCliente";

const TTL_CACHE_SEGUNDOS = 30;
const claveCache = (viajeId: string) => `m7:metodo-pago:${viajeId}`;

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

    // 1. Intentamos leer de la caché primero
    const enCache = await redisBreaker.ejecutar(
      async () => await redis.get(claveCache(viajeId)),
      () => null // si Redis falla, seguimos directo a la base
    );

    if (enCache) {
      res.status(200).json(JSON.parse(enCache));
      return;
    }

    // 2. No estaba en caché: buscamos en la base real
    const metodoPago = await buscarPagoPorViaje(viajeId);

    if (!metodoPago) {
      res.status(404).json({ mensaje: "No se encontró un pago para ese viaje" });
      return;
    }

    // 3. Guardamos en caché para la próxima consulta, con TTL
    await redisBreaker.ejecutar(
      async () => {
        await redis.set(claveCache(viajeId), JSON.stringify(metodoPago), {
          EX: TTL_CACHE_SEGUNDOS,
        });
      },
      () => {} // si Redis falla, no pasa nada
    );

    res.status(200).json(metodoPago);
  } catch (error) {
    // Falla de infraestructura: el servicio no está disponible
    res.status(503).json({ mensaje: "Servicio de pagos no disponible" });
  }
}

export async function autorizarMetodoPago(req: Request, res: Response) {
  try {
    const viajeId = String(req.params.viajeId);
    const { idOrden, total, moneda, token, paymentMethodId, email } = req.body;

    if (!idOrden) {
      res.status(400).json({ mensaje: "idOrden es requerido" });
      return;
    }
    if (typeof total !== "number") {
      res.status(400).json({ mensaje: "total es requerido" });
      return;
    }
    if (!token || !paymentMethodId || !email) {
      res.status(400).json({ mensaje: "token, paymentMethodId y email son requeridos" });
      return;
    }

    const resultadoPago = await procesarPagoMercadoPago({
      idOrden,
      viajeId,
      total,
      token,
      paymentMethodId,
      email,
    });

    if (resultadoPago.status !== "approved") {
      res.status(402).json({
        mensaje: "El pago no fue aprobado por Mercado Pago",
        estadoMP: resultadoPago.status,
        detalle: resultadoPago.statusDetail,
      });
      return;
    }

    const metodoPago = await autorizarPago(viajeId, idOrden, {
      paymentId: resultadoPago.paymentId,
      total,
      moneda: moneda ?? "ARS",
    });

    // Invalidamos la caché: el estado cambió
    await redisBreaker.ejecutar(
      async () => await redis.del(claveCache(viajeId)),
      () => 0
    );

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

    await redisBreaker.ejecutar(
      async () => await redis.del(claveCache(viajeId)),
      () => 0
    );

    res.status(200).json(metodoPago);
  } catch (error) {
    res.status(400).json({
      mensaje: "No se pudo rechazar el pago",
      error: (error as Error).message,
    });
  }
}