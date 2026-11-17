export interface ActiveVehicle {
  patente: string;
  marca: string;
  modelo: string;
}

export type ActiveVehicleLookup = (
  driverUserId: number,
  vehicleType: "AUTO" | "MOTO",
) => Promise<ActiveVehicle | null>;

function nonEmptyText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function createM3ActiveVehicleLookup(baseUrl: string, fetchVehicle: typeof fetch = fetch): ActiveVehicleLookup {
  const base = baseUrl.replace(/\/+$/, "");
  return async (driverUserId, vehicleType) => {
    try {
      const response = await fetchVehicle(`${base}/api/v1/drivers/${driverUserId}/vehicles`, {
        signal: AbortSignal.timeout(1000),
      });
      if (!response.ok) return null;
      const body: unknown = await response.json();
      if (!Array.isArray(body)) return null;
      const matching = body.filter((item): item is Record<string, unknown> =>
        typeof item === "object" && item !== null &&
        item.activo === true && item.tipoServicio === vehicleType &&
        String(item.driverId) === String(driverUserId),
      );
      if (matching.length !== 1) return null;
      const vehicle = matching[0];
      if (!nonEmptyText(vehicle.patente) || !nonEmptyText(vehicle.marca) || !nonEmptyText(vehicle.modelo)) return null;
      return {
        patente: vehicle.patente.trim(),
        marca: vehicle.marca.trim(),
        modelo: vehicle.modelo.trim(),
      };
    } catch {
      return null;
    }
  };
}
