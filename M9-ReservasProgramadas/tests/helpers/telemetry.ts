import { context, logs, metrics, propagation, trace, type Attributes } from '@opentelemetry/api';
import {
  InMemoryLogRecordExporter,
  SimpleLogRecordProcessor,
  type ReadableLogRecord,
} from '@opentelemetry/sdk-logs';
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  PeriodicExportingMetricReader,
  type MetricData,
} from '@opentelemetry/sdk-metrics';
import { InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace';

import { loadTelemetryConfig } from '../../src/observability/config.js';
import { startTelemetry, withGaugeDeltaTemporality } from '../../src/observability/sdk.js';

/**
 * Telemetría real del SDK con exportadores EN MEMORIA: no hay red, ni Alloy, ni Grafana.
 * Permite verificar spans, métricas y logs generados por el código de producción.
 */
export const setupTestTelemetry = () => {
  const spanExporter = new InMemorySpanExporter();
  const logExporter = new InMemoryLogRecordExporter();
  const metricExporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
  const reader = new PeriodicExportingMetricReader({
    exporter: withGaugeDeltaTemporality(metricExporter),
    exportIntervalMillis: 3_600_000,
  });
  const handle = startTelemetry(
    loadTelemetryConfig({
      OTEL_ENABLED: 'true',
      OTEL_SERVICE_NAME: 'm9-reservas-test',
      DEPLOYMENT_ENVIRONMENT: 'test',
      SERVICE_VERSION: 'test',
    }),
    {
      spanProcessors: [new SimpleSpanProcessor({ exporter: spanExporter })],
      metricReaders: [reader],
      logRecordProcessors: [new SimpleLogRecordProcessor({ exporter: logExporter })],
      instrumentations: false,
    },
  );

  const collectMetrics = async (): Promise<MetricData[]> => {
    metricExporter.reset();
    await reader.forceFlush();
    return metricExporter
      .getMetrics()
      .flatMap((resource) => resource.scopeMetrics.flatMap((scope) => scope.metrics));
  };

  const matches = (attributes: Attributes, filter: Attributes): boolean =>
    Object.entries(filter).every(([key, value]) => attributes[key] === value);

  /** Suma de un contador (o cantidad de muestras de un histograma) filtrando por atributos. */
  const metricValue = async (name: string, filter: Attributes = {}): Promise<number> => {
    const metric = (await collectMetrics()).find((item) => item.descriptor.name === name);
    if (metric === undefined) return 0;
    let total = 0;
    for (const point of metric.dataPoints) {
      if (!matches(point.attributes, filter)) continue;
      const value = point.value as number | { count: number };
      total += typeof value === 'number' ? value : value.count;
    }
    return total;
  };

  const metricPoints = async (name: string) =>
    (await collectMetrics()).find((item) => item.descriptor.name === name)?.dataPoints ?? [];

  return {
    spans: spanExporter,
    logRecords: (): ReadableLogRecord[] => logExporter.getFinishedLogRecords(),
    resetLogs: () => logExporter.reset(),
    collectMetrics,
    metricValue,
    metricPoints,
    shutdown: async () => {
      await handle.shutdown();
      trace.disable();
      metrics.disable();
      logs.disable();
      context.disable();
      propagation.disable();
    },
  };
};

export type TestTelemetry = ReturnType<typeof setupTestTelemetry>;
