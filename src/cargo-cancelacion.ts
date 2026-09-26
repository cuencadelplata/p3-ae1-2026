import type { Request, Response } from "express";

const GRACE_PERIOD_SECONDS = 120;

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

type TipoVehiculo = keyof typeof VEHICLE_MULTIPLIER;
type TipoSolicitante = "cliente" | "conductor";
type EstadoViaje =
  | "solicitado"
  | "asignado"
  | "conductor_en_camino"
  | "arribado"
  | "en_curso"
  | "completado"
  | "cancelado";

interface CargoCancelacionRequest {
  tripId: string;
  requestedBy: TipoSolicitante;
  vehicleType: TipoVehiculo;
  tripStatus: EstadoViaje;
  estimatedFare: number;
  assignedAt?: string | Date | null;
  cancelledAt?: string | Date | null;
}

interface CargoCancelacionBreakdown {
  ruleApplied:
    | "sin_conductor_asignado_sin_cargo"
    | "cancelacion_por_conductor_sin_cargo_a_cliente"
    | "dentro_de_periodo_de_gracia"
    | "cliente_cancela_post_asignacion"
    | "cliente_cancela_con_conductor_en_camino_o_arribado";
  vehicleMultiplier: number;
  baseAmount: number | null;
  minClamp: number | null;
  maxClamp: number | null;
  elapsedSecondsSinceAssignment: number | null;
  gracePeriodSeconds: number | null;
}

interface CargoCancelacionResponse {
  tripId: string;
  requestedBy: TipoSolicitante;
  charge: number;
  currency: "ARS";
  breakdown: CargoCancelacionBreakdown;
  message: string;
}

class DominioError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = "DominioError";
    this.statusCode = statusCode;
  }
}

const ESTADOS_NO_CANCELABLES: EstadoViaje[] = [
  "en_curso",
  "completado",
  "cancelado",
];

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

  if (!tripId) throw new DominioError("tripId es obligatorio");
  if (typeof estimatedFare !== "number" || estimatedFare < 0) {
    throw new DominioError("estimatedFare debe ser un numero >= 0");
  }
  if (!VEHICLE_MULTIPLIER[vehicleType]) {
    throw new DominioError("vehicleType debe ser 'auto' o 'moto'");
  }

  if (ESTADOS_NO_CANCELABLES.includes(tripStatus)) {
    throw new DominioError(
      `No se puede calcular un cargo de cancelacion para un viaje en estado '${tripStatus}'`,
      409
    );
  }

  const vehicleMultiplier = VEHICLE_MULTIPLIER[vehicleType];
  const cancelMoment = cancelledAt ? new Date(cancelledAt) : new Date();

  // Caso: todavia no hay conductor asignado -> siempre gratis
  if (tripStatus === "solicitado") {
    return buildResponse(tripId, requestedBy, 0, {
      ruleApplied: "sin_conductor_asignado_sin_cargo",
      vehicleMultiplier,
      baseAmount: 0,
      minClamp: null,
      maxClamp: null,
      elapsedSecondsSinceAssignment: null,
      gracePeriodSeconds: null,
    });
  }

  // Caso: cancela el conductor -> el cliente nunca paga cargo
  if (requestedBy === "conductor") {
    return buildResponse(
      tripId,
      requestedBy,
      0,
      {
        ruleApplied: "cancelacion_por_conductor_sin_cargo_a_cliente",
        vehicleMultiplier,
        baseAmount: 0,
        minClamp: null,
        maxClamp: null,
        elapsedSecondsSinceAssignment: null,
        gracePeriodSeconds: null,
      },
      "Cancelacion realizada por el conductor: no corresponde cargo al cliente."
    );
  }

  // A partir de aca, cancela el CLIENTE con conductor ya asignado.
  if (tripStatus === "asignado") {
    if (!assignedAt) {
      throw new DominioError(
        "assignedAt es obligatorio cuando tripStatus es 'asignado'"
      );
    }
    const elapsedSeconds = Math.max(
      0,
      Math.round(
        (cancelMoment.getTime() - new Date(assignedAt).getTime()) / 1000
      )
    );

    if (elapsedSeconds <= GRACE_PERIOD_SECONDS) {
      return buildResponse(
        tripId,
        requestedBy,
        0,
        {
          ruleApplied: "dentro_de_periodo_de_gracia",
          vehicleMultiplier,
          baseAmount: 0,
          minClamp: null,
          maxClamp: null,
          elapsedSecondsSinceAssignment: elapsedSeconds,
          gracePeriodSeconds: GRACE_PERIOD_SECONDS,
        },
        `Cancelacion dentro del periodo de gracia (${GRACE_PERIOD_SECONDS}s). Sin cargo.`
      );
    }

    const baseAmount = estimatedFare * ASSIGNED_RATE * vehicleMultiplier;
    const charge = round2(clamp(baseAmount, ASSIGNED_MIN, ASSIGNED_MAX));

    return buildResponse(tripId, requestedBy, charge, {
      ruleApplied: "cliente_cancela_post_asignacion",
      vehicleMultiplier,
      baseAmount: round2(baseAmount),
      minClamp: ASSIGNED_MIN,
      maxClamp: ASSIGNED_MAX,
      elapsedSecondsSinceAssignment: elapsedSeconds,
      gracePeriodSeconds: GRACE_PERIOD_SECONDS,
    });
  }

  // tripStatus === "conductor_en_camino" | "arribado"
  const baseAmount = estimatedFare * ARRIVED_RATE * vehicleMultiplier;
  const charge = round2(clamp(baseAmount, ARRIVED_MIN, ARRIVED_MAX));

  return buildResponse(tripId, requestedBy, charge, {
    ruleApplied: "cliente_cancela_con_conductor_en_camino_o_arribado",
    vehicleMultiplier,
    baseAmount: round2(baseAmount),
    minClamp: ARRIVED_MIN,
    maxClamp: ARRIVED_MAX,
    elapsedSecondsSinceAssignment: null,
    gracePeriodSeconds: null,
  });
}

function buildResponse(
  tripId: string,
  requestedBy: CargoCancelacionRequest["requestedBy"],
  charge: number,
  breakdown: CargoCancelacionResponse["breakdown"],
  message?: string
): CargoCancelacionResponse {
  return {
    tripId,
    requestedBy,
    charge,
    currency: "ARS",
    breakdown,
    message:
      message ??
      (charge > 0
        ? `Se calculo un cargo de cancelacion de $${charge} ARS.`
        : "No corresponde cargo de cancelacion."),
  };
}

// --- Handler de Express (agregado para exponer el RF 7.4 como endpoint) ---
export const calcularCargoCancelacionHandler = (req: Request, res: Response) => {
  try {
    const resultado = calcularCargoCancelacion(req.body);
    return res.status(200).json(resultado);
  } catch (error: any) {
    const statusCode = error.statusCode ?? 400;
    return res.status(statusCode).json({ error: error.message || "Error al calcular cargo de cancelación" });
  }
};