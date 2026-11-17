import 'dotenv/config';

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { z } from 'zod';

/**
 * Configuración de telemetría. Se lee por separado de `config/env.ts` porque este módulo se
 * carga con `node --import` antes que la aplicación y no debe depender de sus variables.
 *
 * Por defecto la telemetría está APAGADA: el inicio normal y las pruebas no necesitan Alloy
 * ni una cuenta de Grafana Cloud. Con `OTEL_ENABLED=false` la API de OpenTelemetry queda en
 * modo no-op y las llamadas de métricas/trazas no tienen efecto.
 */

const booleanFromEnv = (defaultValue: boolean) =>
  z.preprocess((value) => {
    if (value === undefined || value === '') return defaultValue;
    if (typeof value === 'string') return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
    return value;
  }, z.boolean());

const readPackageVersion = (): string => {
  try {
    const raw = readFileSync(path.resolve('package.json'), 'utf8');
    const parsed = JSON.parse(raw) as { version?: unknown };
    return typeof parsed.version === 'string' ? parsed.version : 'desconocida';
  } catch {
    return 'desconocida';
  }
};

const telemetrySchema = z.object({
  OTEL_ENABLED: booleanFromEnv(false),
  OTEL_SERVICE_NAME: z.string().min(1).default('m9-reservas'),
  OTEL_SERVICE_NAMESPACE: z.string().min(1).default('uber-p3'),
  SERVICE_VERSION: z.string().min(1).optional(),
  DEPLOYMENT_ENVIRONMENT: z.string().min(1).default('local'),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().default('http://localhost:4318'),
  OTEL_TRACES_SAMPLER_RATIO: z.coerce.number().min(0).max(1).default(1),
  OTEL_METRIC_EXPORT_INTERVAL_MS: z.coerce.number().int().min(1_000).default(15_000),
  OTEL_EXPORT_TIMEOUT_MS: z.coerce.number().int().min(500).default(5_000),
  OTEL_SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().min(100).default(3_000),
  OTEL_LOGS_ENABLED: booleanFromEnv(true),
  OTEL_STATE_COLLECTOR_INTERVAL_MS: z.coerce.number().int().min(1_000).default(15_000),
  OTEL_STUCK_ACTIVATION_THRESHOLD_SECONDS: z.coerce.number().int().positive().default(120),
});

export interface TelemetryConfig {
  enabled: boolean;
  serviceName: string;
  serviceNamespace: string;
  serviceVersion: string;
  environment: string;
  otlpEndpoint: string;
  samplerRatio: number;
  metricExportIntervalMs: number;
  exportTimeoutMs: number;
  shutdownTimeoutMs: number;
  logsEnabled: boolean;
  stateCollectorIntervalMs: number;
  stuckActivationThresholdSeconds: number;
}

export const loadTelemetryConfig = (source: NodeJS.ProcessEnv = process.env): TelemetryConfig => {
  const parsed = telemetrySchema.safeParse(source);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Configuración de telemetría inválida: ${details}`);
  }
  const value = parsed.data;
  return {
    enabled: value.OTEL_ENABLED,
    serviceName: value.OTEL_SERVICE_NAME,
    serviceNamespace: value.OTEL_SERVICE_NAMESPACE,
    serviceVersion: value.SERVICE_VERSION ?? readPackageVersion(),
    environment: value.DEPLOYMENT_ENVIRONMENT,
    otlpEndpoint: value.OTEL_EXPORTER_OTLP_ENDPOINT.replace(/\/+$/, ''),
    samplerRatio: value.OTEL_TRACES_SAMPLER_RATIO,
    metricExportIntervalMs: value.OTEL_METRIC_EXPORT_INTERVAL_MS,
    exportTimeoutMs: value.OTEL_EXPORT_TIMEOUT_MS,
    shutdownTimeoutMs: value.OTEL_SHUTDOWN_TIMEOUT_MS,
    logsEnabled: value.OTEL_LOGS_ENABLED,
    stateCollectorIntervalMs: value.OTEL_STATE_COLLECTOR_INTERVAL_MS,
    stuckActivationThresholdSeconds: value.OTEL_STUCK_ACTIVATION_THRESHOLD_SECONDS,
  };
};

let cachedConfig: TelemetryConfig | undefined;

/** Configuración efectiva del proceso (memoizada). */
export const telemetryConfig = (): TelemetryConfig => {
  cachedConfig ??= loadTelemetryConfig();
  return cachedConfig;
};
