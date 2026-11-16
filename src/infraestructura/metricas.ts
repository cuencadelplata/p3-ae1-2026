import { Registry, Counter, Histogram, collectDefaultMetrics } from "prom-client";

export const registry = new Registry();

collectDefaultMetrics({ register: registry });

// Aylen — Reintegros
export const reintegrosProcesadosTotal = new Counter({
  name: "reintegros_procesados_total",
  help: "Cantidad de reintegros procesados exitosamente",
  registers: [registry],
});

export const reintegroDuracionSegundos = new Histogram({
  name: "reintegro_duracion_segundos",
  help: "Duración del flujo completo de reintegro (MP + Supabase) en segundos",
  buckets: [0.1, 0.5, 1, 2, 5, 10],
  registers: [registry],
});

// Matilda — Pagos
export const pagosAutorizadosTotal = new Counter({
  name: "pagos_autorizados_total",
  help: "Cantidad de pagos autorizados exitosamente por Mercado Pago",
  registers: [registry],
});

export const pagoDuracionSegundos = new Histogram({
  name: "pago_duracion_segundos",
  help: "Duración del flujo de autorización de pago en Mercado Pago en segundos",
  buckets: [0.1, 0.5, 1, 2, 5, 10],
  registers: [registry],
});

// Lautaro — Estimación de tarifa
export const estimacionesTarifaTotal = new Counter({
  name: "estimaciones_tarifa_total",
  help: "Cantidad de estimaciones de tarifa calculadas (usuarios que consultan precio antes de viajar)",
  registers: [registry],
});