import { calculoReintegro } from "./calculoReintegro";
import { obtenerCargo, type CargoRequest } from "./cargoCancelacionClient";
import { existeOrden, insertarReintegro } from "./reintegroBD";
import { estaEnCache, marcarEnCache } from "../infraestructura/redis";
import { publicar } from "../infraestructura/rabbit";

// Contrato del evento viaje.cancelad, publica M6
export interface ViajeCanceladoEvento {
  idOrden: string;
  viajeId: string;
  requestedBy: "cliente" | "conductor";
  vehicleType: "auto" | "moto";
  tripStatus: string;
  estimatedFare: number;
  assignedAt?: string | undefined;
  arrivedAt?: string | undefined;
  cancelledAt?: string | undefined;
  reason?: string | undefined;
}

export type Resultado = "procesado" | "duplicado" | "sin_cargo";

const redondear = (n: number) => Math.round(n * 100) / 100;

export async function procesarReintegro(ev: ViajeCanceladoEvento): Promise<Resultado> {
  // 1) Idempotencia: Redis, y si no, la base
  if ((await estaEnCache(ev.idOrden)) || (await existeOrden(ev.idOrden))) {
    await marcarEnCache(ev.idOrden);
    return "duplicado";
  }

  // 2) El cargo lo calcula RF-7.4
  const request: CargoRequest = {
    tripId: ev.viajeId,
    requestedBy: ev.requestedBy,
    vehicleType: ev.vehicleType,
    tripStatus: ev.tripStatus,
    estimatedFare: ev.estimatedFare,
    assignedAt: ev.assignedAt,
    arrivedAt: ev.arrivedAt,
    cancelledAt: ev.cancelledAt,
    reason: ev.reason,
  };
  const cargo = await obtenerCargo(request);
  if (cargo <= 0) return "sin_cargo";

  // 3) Reintegro (RF-7.5) y registro
  const montoReintegro = redondear(calculoReintegro(cargo));
  const insertado = await insertarReintegro({
    idOrden: ev.idOrden,
    viajeId: ev.viajeId,
    montoCancelacion: cargo,
    montoReintegro,
  });
  await marcarEnCache(ev.idOrden);
  if (!insertado) return "duplicado";

  // 4) Segundo flujo asíncrono: avisar a M8
  publicar(
    "reintegro.procesado",
    { idOrden: ev.idOrden, viajeId: ev.viajeId, montoReintegro },
    ev.idOrden
  );
  return "procesado";
}