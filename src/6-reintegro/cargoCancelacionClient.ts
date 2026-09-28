import { config } from "../config";

export class ErrorTransitorio extends Error {}
export class ErrorPermanente extends Error {} 

export interface CargoRequest {
  tripId: string;
  requestedBy: "cliente" | "conductor";
  vehicleType: "auto" | "moto";
  tripStatus: string;
  estimatedFare: number;
  assignedAt?: string | undefined;
  arrivedAt?: string | undefined;
  cancelledAt?: string | undefined;
  reason?: string | undefined;
}

export async function obtenerCargo(body: CargoRequest): Promise<number> {
  let res: Response;
  try {
    res = await fetch(`${config.cargoCancelacionUrl}/api/m7/cargo-cancelacion`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(3000),
    });
  } catch (e) {
    throw new ErrorTransitorio(`cargo-cancelacion no responde: ${(e as Error).message}`);
  }

  if (res.status >= 500) throw new ErrorTransitorio(`cargo-cancelacion devolvió ${res.status}`);
  if (!res.ok) throw new ErrorPermanente(`cargo-cancelacion rechazó el request (${res.status})`);

  const data = (await res.json()) as { charge?: number };
  if (typeof data.charge !== "number") throw new ErrorPermanente("Respuesta sin 'charge'");
  return data.charge;
}