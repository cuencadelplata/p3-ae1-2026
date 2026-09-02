import {
  CargoCancelacionRequest,
  CargoCancelacionResponse,
  DominioError,
  EstadoViaje,
} from "./types";

/**
 * REGLAS DE NEGOCIO SIMULADAS (RF-7.4 - Cargo de cancelacion)
 * ------------------------------------------------------------
 * El escenario no provee las reglas reales de negocio para el calculo del
 * cargo de cancelacion, por lo que fueron inventadas para esta entrega
 * (AE1) a modo de simulacion. Quedan documentadas aqui para que puedan
 * discutirse, ajustarse o reemplazarse en AE2 sin tocar el resto del
 * servicio.
 *
 * 1) Estados terminales (en_curso, completado, cancelado) no admiten un
 *    nuevo calculo de cargo de cancelacion -> error de negocio (409).
 *
 * 2) Si el viaje todavia esta "solicitado" (sin conductor asignado), la
 *    cancelacion es siempre gratuita: no hay conductor comprometido.
 *
 * 3) Si quien cancela es el CONDUCTOR, el cliente nunca recibe cargo
 *    (RF-6.6 lo trata como responsabilidad del conductor, penalizacion de
 *    reputacion queda fuera del alcance de M7).
 *
 * 4) Si quien cancela es el CLIENTE y el viaje esta "asignado":
 *    - Existe un periodo de gracia de GRACE_PERIOD_SECONDS desde que el
 *      conductor acepto (assignedAt). Dentro de ese periodo, cargo = 0.
 *    - Superado el periodo de gracia, se cobra:
 *        cargo = estimatedFare * ASSIGNED_RATE * multiplicadorVehiculo
 *      con piso y techo (clamp) fijos.
 *
 * 5) Si quien cancela es el CLIENTE y el conductor ya esta en camino o ya
 *    arribo al punto de retiro ("conductor_en_camino" | "arribado"), se
 *    aplica una tarifa mayor porque el conductor ya recorrio distancia o
 *    esta esperando:
 *        cargo = estimatedFare * ARRIVED_RATE * multiplicadorVehiculo
 *    tambien con piso y techo propios.
 *
 * 6) Multiplicador por tipo de vehiculo: Auto = 1.0, Moto = 0.7 (el viaje
 *    en moto se asume de menor costo operativo para el conductor).
 */

const GRACE_PERIOD_SECONDS = 120; // 2 minutos desde la asignacion

const ASSIGNED_RATE = 0.2; // 20% de la tarifa estimada
const ASSIGNED_MIN = 300;
const ASSIGNED_MAX = 1500;

const ARRIVED_RATE = 0.5; // 50% de la tarifa estimada
const ARRIVED_MIN = 500;
const ARRIVED_MAX = 3000;

const VEHICLE_MULTIPLIER: Record<string, number> = {
  auto: 1.0,
  moto: 0.7,
};

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