import type { Request, Response } from "express";

// --- Tipos / Interfaces ---
export interface EstimacionTarifaRequest {
  origen: { lat: number; lng: number; direccion?: string };
  destino: { lat: number; lng: number; direccion?: string };
  distanciaKm: number;
  tiempoEstimadoMin: number;
  vehicleType: "auto" | "moto";
}

export interface EstimacionTarifaResponse {
  estimacionId: string;
  distanciaKm: number;
  tiempoEstimadoMin: number;
  vehicleType: string;
  estimatedFare: number;
  currency: string;
  desglose: {
    tarifaBase: number;
    costoDistancia: number;
    costoTiempo: number;
    multiplicadorVehiculo: number;
  };
  calculadoEn: string;
}

// --- Dominio / Lógica de Cálculo (RF 7.1) ---
const TARIFA_BASE = 500;
const PRECIO_POR_KM = 250;
const PRECIO_POR_MINUTO = 50;

const VEHICLE_MULTIPLIER = {
  auto: 1.0,
  moto: 0.7,
};

export function calcularEstimacionTarifa(
  req: EstimacionTarifaRequest
): EstimacionTarifaResponse {
  const { distanciaKm, tiempoEstimadoMin, vehicleType } = req;

  if (typeof distanciaKm !== "number" || distanciaKm <= 0) {
    throw new Error("distanciaKm debe ser un número mayor a 0");
  }
  if (typeof tiempoEstimadoMin !== "number" || tiempoEstimadoMin <= 0) {
    throw new Error("tiempoEstimadoMin debe ser un número mayor a 0");
  }
  if (!VEHICLE_MULTIPLIER[vehicleType]) {
    throw new Error("vehicleType debe ser 'auto' o 'moto'");
  }

  const multiplicador = VEHICLE_MULTIPLIER[vehicleType];
  const costoDistancia = distanciaKm * PRECIO_POR_KM;
  const costoTiempo = tiempoEstimadoMin * PRECIO_POR_MINUTO;

  const subtotal = TARIFA_BASE + costoDistancia + costoTiempo;
  const estimatedFare = Math.round(subtotal * multiplicador * 100) / 100;

  return {
    estimacionId: `est_${Date.now()}`,
    distanciaKm,
    tiempoEstimadoMin,
    vehicleType,
    estimatedFare,
    currency: "ARS",
    desglose: {
      tarifaBase: TARIFA_BASE,
      costoDistancia,
      costoTiempo,
      multiplicadorVehiculo: multiplicador,
    },
    calculadoEn: new Date().toISOString(),
  };
}

// --- Handler de Express ---
export const estimarTarifaHandler = (req: Request, res: Response) => {
  try {
    const resultado = calcularEstimacionTarifa(req.body);
    return res.status(200).json(resultado);
  } catch (error: any) {
    return res.status(400).json({ error: error.message || "Error al calcular estimación" });
  }
};