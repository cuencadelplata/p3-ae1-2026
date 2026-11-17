import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';

import { context, logs, metrics, propagation, trace } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import {
  CompositePropagator,
  W3CBaggagePropagator,
  W3CTraceContextPropagator,
} from '@opentelemetry/core';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { RuntimeNodeInstrumentation } from '@opentelemetry/instrumentation-runtime-node';
import { UndiciInstrumentation } from '@opentelemetry/instrumentation-undici';
import { resourceFromAttributes, type Resource } from '@opentelemetry/resources';
import {
  BatchLogRecordProcessor,
  LoggerProvider,
  type LogRecordProcessor,
} from '@opentelemetry/sdk-logs';
import {
  AggregationTemporality,
  InstrumentType,
  MeterProvider,
  PeriodicExportingMetricReader,
  type IMetricReader,
  type PushMetricExporter,
} from '@opentelemetry/sdk-metrics';
import {
  BatchSpanProcessor,
  ParentBasedSampler,
  TraceIdRatioBasedSampler,
  TracerProvider,
  type SpanProcessor,
} from '@opentelemetry/sdk-trace';
import {
  PrismaInstrumentation,
  registerInstrumentations as registerPrismaInstrumentations,
} from '@prisma/instrumentation';

import type { TelemetryConfig } from './config.js';

export interface TelemetryHandle {
  forceFlush(): Promise<void>;
  shutdown(): Promise<void>;
}

/** Permite reemplazar exportadores en pruebas (memoria) sin tocar la red. */
export interface TelemetryOverrides {
  spanProcessors?: SpanProcessor[];
  metricReaders?: IMetricReader[];
  logRecordProcessors?: LogRecordProcessor[];
  instrumentations?: boolean;
}

export const NOOP_TELEMETRY: TelemetryHandle = {
  forceFlush: async () => undefined,
  shutdown: async () => undefined,
};

export const buildResource = (config: TelemetryConfig): Resource =>
  resourceFromAttributes({
    'service.name': config.serviceName,
    'service.namespace': config.serviceNamespace,
    'service.version': config.serviceVersion,
    'service.instance.id': `${hostname()}-${randomUUID().slice(0, 8)}`,
    'deployment.environment.name': config.environment,
  });

/**
 * Gauges observables en DELTA, el resto acumulativo (lo que espera Mimir).
 * Con temporalidad acumulativa el SDK reexporta el último valor de un gauge aunque su
 * callback ya no lo observe; eso convertiría un recolector caído en un dato falso.
 * En OTLP los gauges no tienen temporalidad, así que el backend no ve diferencia.
 */
export const withGaugeDeltaTemporality = (exporter: PushMetricExporter): PushMetricExporter => ({
  export: (metricsData, callback) => exporter.export(metricsData, callback),
  forceFlush: () => exporter.forceFlush(),
  shutdown: () => exporter.shutdown(),
  selectAggregationTemporality: (instrumentType) =>
    instrumentType === InstrumentType.OBSERVABLE_GAUGE || instrumentType === InstrumentType.GAUGE
      ? AggregationTemporality.DELTA
      : AggregationTemporality.CUMULATIVE,
});

const withTimeout = async (action: Promise<unknown>, timeoutMs: number): Promise<void> => {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, timeoutMs);
    timer.unref();
  });
  try {
    await Promise.race([action.then(() => undefined).catch(() => undefined), timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
};

/**
 * Inicializa trazas, métricas y logs con exportación OTLP/HTTP hacia Grafana Alloy.
 * No usa `@opentelemetry/sdk-node` para no arrastrar el exportador Prometheus: cada señal
 * tiene una sola vía (OTLP → Alloy → Grafana Cloud).
 */
export const startTelemetry = (
  config: TelemetryConfig,
  overrides: TelemetryOverrides = {},
): TelemetryHandle => {
  const resource = buildResource(config);
  const endpoint = config.otlpEndpoint;
  const timeoutMillis = config.exportTimeoutMs;

  context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
  propagation.setGlobalPropagator(
    new CompositePropagator({
      propagators: [new W3CTraceContextPropagator(), new W3CBaggagePropagator()],
    }),
  );

  const tracerProvider = new TracerProvider({
    resource,
    sampler: new ParentBasedSampler({
      root: new TraceIdRatioBasedSampler(config.samplerRatio),
    }),
    spanProcessors: overrides.spanProcessors ?? [
      new BatchSpanProcessor({
        exporter: new OTLPTraceExporter({ url: `${endpoint}/v1/traces`, timeoutMillis }),
        exportTimeoutMillis: timeoutMillis,
      }),
    ],
  });
  trace.setGlobalTracerProvider(tracerProvider);

  const meterProvider = new MeterProvider({
    resource,
    readers: overrides.metricReaders ?? [
      new PeriodicExportingMetricReader({
        exporter: withGaugeDeltaTemporality(
          new OTLPMetricExporter({ url: `${endpoint}/v1/metrics`, timeoutMillis }),
        ),
        exportIntervalMillis: config.metricExportIntervalMs,
        exportTimeoutMillis: Math.min(timeoutMillis, config.metricExportIntervalMs),
      }),
    ],
  });
  metrics.setGlobalMeterProvider(meterProvider);

  let loggerProvider: LoggerProvider | undefined;
  if (config.logsEnabled) {
    loggerProvider = new LoggerProvider({
      resource,
      processors: overrides.logRecordProcessors ?? [
        new BatchLogRecordProcessor({
          exporter: new OTLPLogExporter({ url: `${endpoint}/v1/logs`, timeoutMillis }),
          exportTimeoutMillis: timeoutMillis,
        }),
      ],
    });
    logs.setGlobalLoggerProvider(loggerProvider);
  }

  if (overrides.instrumentations !== false) {
    // Runtime: event loop, GC y heap V8 del PROCESO (no del host ni del contenedor).
    // Undici: spans cliente y propagación W3C en fetch() hacia M5/M7.
    registerInstrumentations({
      tracerProvider,
      meterProvider,
      instrumentations: [
        new RuntimeNodeInstrumentation({ monitoringPrecision: 5_000 }),
        new UndiciInstrumentation(),
      ],
    });
    // Prisma usa su propia versión de @opentelemetry/instrumentation; se registra aparte.
    registerPrismaInstrumentations({
      tracerProvider,
      instrumentations: [new PrismaInstrumentation()],
    });
  }

  const providers = [tracerProvider, meterProvider, ...(loggerProvider ? [loggerProvider] : [])];

  return {
    forceFlush: () =>
      withTimeout(
        Promise.allSettled(providers.map((provider) => provider.forceFlush())),
        config.shutdownTimeoutMs,
      ),
    // El cierre tiene plazo acotado: un Alloy caído nunca bloquea la salida del proceso.
    shutdown: () =>
      withTimeout(
        Promise.allSettled(providers.map((provider) => provider.shutdown())),
        config.shutdownTimeoutMs,
      ),
  };
};
