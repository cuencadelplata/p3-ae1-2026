import { redis, redisBreaker } from "../../infraestructura/redis";
import { Request, Response } from "express";
import {
  autorizarPago, buscarPagoPorViaje, cambiarTarjetaPendiente, conBloqueoDePago,
  ordenRegistrada, PagoEnProceso, rechazarPago, registrarMetodoPago, registrarOrdenTarjeta,
} from "./procesoPago";
import { confirmarRechazoMercadoPago, procesarPagoMercadoPago } from "./PagoCliente";
import { pagosAutorizadosTotal, pagoDuracionSegundos } from "../../infraestructura/metricas";

const TARJETA_PRUEBA = {
  card_number: "4509953566233704",
  security_code: "123",
  expiration_month: 11,
  expiration_year: 2030,
  cardholder: { name: "APRO", identification: { type: "DNI", number: "12345678" } },
};

async function generarTokenTarjeta(): Promise<{ token: string; paymentMethodId: string }> {
  const { config } = await import("../../config");
  const response = await fetch(`${config.mpBaseUrl}/v1/card_tokens`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
            authorization: `Bearer ${config.mpAccessToken}`,
    },
    body: JSON.stringify(TARJETA_PRUEBA),
    signal: AbortSignal.timeout(10_000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`No se pudo generar token de prueba: ${data.message ?? response.status}`);
  }
  return { token: data.id, paymentMethodId: "visa" };
}

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

    const enCache = await redisBreaker.ejecutar(
      async () => await redis.get(claveCache(viajeId)),
      () => null
    );

    if (enCache) {
      res.status(200).json(JSON.parse(enCache));
      return;
    }

    const metodoPago = await buscarPagoPorViaje(viajeId);

    if (!metodoPago) {
      res.status(404).json({ mensaje: "No se encontró un pago para ese viaje" });
      return;
    }

    await redisBreaker.ejecutar(
      async () => {
        await redis.set(claveCache(viajeId), JSON.stringify(metodoPago), {
          EX: TTL_CACHE_SEGUNDOS,
        });
      },
      () => {}
    );

    res.status(200).json(metodoPago);
  } catch (error) {
    res.status(503).json({ mensaje: "Servicio de pagos no disponible" });
  }
}

export async function autorizarMetodoPago(req: Request, res: Response) {
  try {
    const viajeId = String(req.params.viajeId);
    const { idOrden, total, moneda, token, paymentMethodId, email } = req.body;

    if (typeof idOrden !== "string" || !idOrden.trim() || idOrden.length > 64) {
      res.status(400).json({ mensaje: "idOrden es requerido" });
      return;
    }
    if (typeof total !== "number") {
      res.status(400).json({ mensaje: "total es requerido" });
      return;
    }

    const result = await conBloqueoDePago(viajeId, async () => {
      const pago = await buscarPagoPorViaje(viajeId);
      if (!pago || pago.estado !== "pendiente" || pago.tipo !== "tarjeta") {
        return { status: 400, body: { mensaje: "Se requiere un pago con tarjeta pendiente para este viaje" } };
      }
      const orden = ordenRegistrada(pago);
      if (orden && orden !== idOrden) {
        return { status: 409, body: { mensaje: "Ya hay una orden de tarjeta registrada para este viaje" } };
      }
      const tarjeta = token && paymentMethodId ? { token, paymentMethodId } : await generarTokenTarjeta();
      if (!orden) await registrarOrdenTarjeta(pago, idOrden);
      const finTimer = pagoDuracionSegundos.startTimer();
      const resultadoPago = await procesarPagoMercadoPago({
        ...tarjeta, idOrden, viajeId, total, email: email ?? "test@prueba.com",
      }).finally(finTimer);
      if (resultadoPago.status !== "approved") {
        return {
          status: resultadoPago.status === "rejected" ? 402 : 409,
          body: { mensaje: "El pago no fue aprobado por Mercado Pago", estadoMP: resultadoPago.status, detalle: resultadoPago.statusDetail },
        };
      }
      const actualizado = await autorizarPago(viajeId, idOrden, {
        paymentId: resultadoPago.paymentId, total, moneda: moneda ?? "ARS",
      }, pago);
      pagosAutorizadosTotal.inc();
      await redisBreaker.ejecutar(() => redis.del(claveCache(viajeId)), () => 0);
      return { status: 200, body: actualizado };
    });
    res.status(result.status).json(result.body);
  } catch (error) {
    if (error instanceof PagoEnProceso) {
      res.status(409).json({ mensaje: "Ya hay una operación de pago en curso" });
      return;
    }
    res.status(400).json({
      mensaje: "No se pudo autorizar el pago",
      error: (error as Error).message,
    });
  }
}

export async function reemplazarTarjetaRechazada(req: Request, res: Response) {
  const viajeId = String(req.params.viajeId);
  const { tipo } = req.body ?? {};
  if (tipo !== "efectivo" && tipo !== "transferencia") {
    res.status(400).json({ mensaje: "El nuevo medio debe ser efectivo o transferencia" });
    return;
  }
  try {
    const result = await conBloqueoDePago(viajeId, async () => {
      const pago = await buscarPagoPorViaje(viajeId);
      if (!pago) {
        return { status: 404, body: { mensaje: "No se encontró un pago para ese viaje" } };
      }
      if (pago.tipo === tipo && pago.estado === "pendiente") {
        return { status: 200, body: pago };
      }
      if (pago.tipo !== "tarjeta" || pago.estado !== "pendiente" || pago.paymentId ||
          !(await confirmarRechazoMercadoPago(ordenRegistrada(pago) ?? `ORD-${viajeId}`))) {
        return { status: 409, body: { mensaje: "Mercado Pago aún no confirma que la tarjeta se pueda reemplazar" } };
      }
      const actualizado = await cambiarTarjetaPendiente(viajeId, tipo);
      await redisBreaker.ejecutar(() => redis.del(claveCache(viajeId)), () => 0);
      return { status: 200, body: actualizado };
    });
    res.status(result.status).json(result.body);
  } catch (error) {
    if (error instanceof PagoEnProceso) {
      res.status(409).json({ mensaje: "Ya hay una operación de pago en curso" });
      return;
    }
    res.status(503).json({ mensaje: "No se pudo verificar o cambiar el medio en este momento" });
  }
}

export async function rechazarMetodoPago(req: Request, res: Response) {
  try {
    const viajeId = String(req.params.viajeId);
    const metodoPago = await conBloqueoDePago(viajeId, () => rechazarPago(viajeId));

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
