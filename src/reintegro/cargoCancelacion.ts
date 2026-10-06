export const GRACE_PERIOD_SECONDS = 120;

const ASSIGNED_RATE = 0.2;
const ASSIGNED_MIN = 300;
const ASSIGNED_MAX = 1500;

const ARRIVED_RATE = 0.5;
const ARRIVED_MIN = 500;
const ARRIVED_MAX = 3000;

const VEHICLE_MULTIPLIER = {
  auto: 1.0,
  moto: 0.7,
};

export type TipoVehiculo = keyof typeof VEHICLE_MULTIPLIER;
export type TipoSolicitante = "cliente" | "conductor";
export type EstadoViaje =
  | "solicitado"
  | "asignado"
  | "conductor_en_camino"
  | "arribado"
  | "en_curso"
  | "completado"
  | "cancelado";

export interface CargoCancelacionRequest {
  tripId: string;
  requestedBy: TipoSolicitante;
  vehicleType: TipoVehiculo;
  tripStatus: EstadoViaje;
  estimatedFare: number;
  assignedAt?: string | Date | null;
  cancelledAt?: string | Date | null;
}

export interface CargoCancelacionResponse {
  tripId: string;
  requestedBy: TipoSolicitante;
  charge: number;
  currency: "ARS";
  message: string;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function calcularCargoCancelacion(
  req: CargoCancelacionRequest
): CargoCancelacionResponse {
  const {
    tripId,
    requestedBy,
    vehicleType,
    tripStatus,
    estimatedFare,
    assignedAt,
    cancelledAt,
  } = req;

  const vehicleMultiplier = VEHICLE_MULTIPLIER[vehicleType] ?? 1.0;
  const cancelMoment = cancelledAt ? new Date(cancelledAt) : new Date();

  // Caso: Sin conductor asignado o cancela el conductor -> Sin cargo
  if (tripStatus === "solicitado" || requestedBy === "conductor") {
    return {
      tripId,
      requestedBy,
      charge: 0,
      currency: "ARS",
      message: "Sin cargo de cancelación.",
    };
  }

  // Caso: Cancela el cliente con conductor asignado
  if (tripStatus === "asignado") {
    const elapsedSeconds = assignedAt
      ? Math.max(0, Math.round((cancelMoment.getTime() - new Date(assignedAt).getTime()) / 1000))
      : 0;

    if (elapsedSeconds <= GRACE_PERIOD_SECONDS) {
      return {
        tripId,
        requestedBy,
        charge: 0,
        currency: "ARS",
        message: `Cancelación dentro del periodo de gracia (${GRACE_PERIOD_SECONDS}s). Sin cargo.`,
      };
    }

    const baseAmount = estimatedFare * ASSIGNED_RATE * vehicleMultiplier;
    const charge = round2(clamp(baseAmount, ASSIGNED_MIN, ASSIGNED_MAX));

    return {
      tripId,
      requestedBy,
      charge,
      currency: "ARS",
      message: `Cargo de cancelación calculado: $${charge} ARS.`,
    };
  }

  // Caso: Conductor en camino o arribado
  const baseAmount = estimatedFare * ARRIVED_RATE * vehicleMultiplier;
  const charge = round2(clamp(baseAmount, ARRIVED_MIN, ARRIVED_MAX));

  return {
    tripId,
    requestedBy,
    charge,
    currency: "ARS",
    message: `Cargo de cancelación calculado: $${charge} ARS.`,
  };
}