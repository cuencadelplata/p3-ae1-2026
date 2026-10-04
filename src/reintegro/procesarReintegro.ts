import { calculoReintegro } from "./calculoReintegro";
import { obtenerCargo, type CargoRequest } from "./cargoCancelacionClient";
import { existeOrden, insertarReintegro } from "./reintegroBD";
import { estaEnCache, marcarEnCache } from "../infraestructura/redis";
import { publicar } from "../infraestructura/rabbit";

export interface EventoCancelacionM6 {
  viajeId: string;
  clienteId: string;
  conductorId?: string;
  motivo: string;
  evento: "cancelacion_cliente" | "despacho.reabrir";
  timestamp: string;
}

export type Resultado = "procesado" | "duplicado" | "sin_cargo";

const redondear = (n: number) => Math.round(n * 100) / 100;

const ESTIMATED_FARE_DEFAULT = 5000;
const VEHICLE_TYPE_DEFAULT = "auto" as const;
const TRIP_STATUS_DEFAULT = "asignado";

export async function procesarReintegro(ev: EventoCancelacionM6): Promise<Resultado> {
  const idOrden = ev.viajeId;
  const requestedBy = ev.evento === "cancelacion_cliente" ? "cliente" : "conductor";

  // Verificación de idempotencia (primero Redis, si no PostgreSQL)
  if ((await estaEnCache(idOrden)) || (await existeOrden(idOrden))) {
    await marcarEnCache(idOrden);
    return "duplicado";
  }

  const request: CargoRequest = {
    tripId: ev.viajeId,
    requestedBy,
    vehicleType: VEHICLE_TYPE_DEFAULT,
    tripStatus: TRIP_STATUS_DEFAULT,
    estimatedFare: ESTIMATED_FARE_DEFAULT,
    cancelledAt: ev.timestamp,
  };

  const cargo = await obtenerCargo(request);
  if (cargo <= 0) return "sin_cargo";

  const montoReintegro = redondear(calculoReintegro(cargo));
  const insertado = await insertarReintegro({
    idOrden,
    viajeId: ev.viajeId,
    montoCancelacion: cargo,
    montoReintegro,
  });

  await marcarEnCache(idOrden);
  if (!insertado) return "duplicado";

  publicar(
    "reintegro.procesado",
    { idOrden, viajeId: ev.viajeId, montoReintegro },
    idOrden
  );
  return "procesado";
}
