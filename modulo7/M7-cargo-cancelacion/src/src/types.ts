// M7 - Tarifas, Pagos y Liquidaciones
// RF-7.4 - Cargo de cancelacion

export type TipoVehiculo = "auto" | "moto";

export type EstadoViaje =
  | "solicitado" // aun sin conductor asignado
  | "asignado" // conductor acepto la oferta, todavia no salio / no llego
  | "conductor_en_camino"
  | "arribado" // conductor llego al punto de retiro y espera al cliente
  | "en_curso"
  | "completado"
  | "cancelado";

export type SolicitanteCancelacion = "cliente" | "conductor";

export interface CargoCancelacionRequest {
  tripId: string;
  requestedBy: SolicitanteCancelacion;
  vehicleType: TipoVehiculo;
  tripStatus: EstadoViaje;
  estimatedFare: number; // tarifa estimada del viaje (RF-7.1), en ARS
  assignedAt?: string; // ISO 8601 - momento en que el conductor acepto
  arrivedAt?: string; // ISO 8601 - momento en que el conductor arribo
  cancelledAt?: string; // ISO 8601 - default: ahora
  reason?: string;
}

export interface CargoCancelacionBreakdown {
  ruleApplied: string;
  vehicleMultiplier: number;
  baseAmount: number;
  minClamp: number | null;
  maxClamp: number | null;
  elapsedSecondsSinceAssignment: number | null;
  gracePeriodSeconds: number | null;
}

export interface CargoCancelacionResponse {
  tripId: string;
  requestedBy: SolicitanteCancelacion;
  charge: number;
  currency: "ARS";
  breakdown: CargoCancelacionBreakdown;
  message: string;
}

export class DominioError extends Error {
  constructor(message: string, public statusCode: number = 400) {
    super(message);
    this.name = "DominioError";
  }
}