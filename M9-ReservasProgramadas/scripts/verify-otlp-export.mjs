/**
 * Verificación LOCAL de exportación OTLP/HTTP sin Docker ni Grafana Cloud.
 *
 * Levanta un receptor OTLP falso en 127.0.0.1:4318 (imita a Alloy), inicia la telemetría real
 * de M9 (`dist/observability/register.js`) y el stub M7 instrumentado, hace solicitudes HTTP y
 * muestra qué métricas, spans y logs llegaron. Requiere `npm run build` previo.
 *
 * Uso: npm run telemetry:verify-export
 */
import { createServer } from 'node:http';

const received = { metrics: new Set(), spans: [], logs: [], resources: new Set() };

const collector = createServer((request, response) => {
  let body = '';
  request.on('data', (chunk) => (body += chunk));
  request.on('end', () => {
    try {
      const payload = JSON.parse(body);
      if (request.url === '/v1/metrics') {
        for (const resource of payload.resourceMetrics ?? []) {
          const service = resource.resource.attributes.find((a) => a.key === 'service.name');
          received.resources.add(service?.value.stringValue);
          for (const scope of resource.scopeMetrics ?? []) {
            for (const metric of scope.metrics ?? []) received.metrics.add(metric.name);
          }
        }
      } else if (request.url === '/v1/traces') {
        for (const resource of payload.resourceSpans ?? []) {
          const service = resource.resource.attributes.find((a) => a.key === 'service.name');
          for (const scope of resource.scopeSpans ?? []) {
            for (const span of scope.spans ?? []) {
              received.spans.push({
                service: service?.value.stringValue,
                name: span.name,
                traceId: span.traceId,
              });
            }
          }
        }
      } else if (request.url === '/v1/logs') {
        for (const resource of payload.resourceLogs ?? []) {
          for (const scope of resource.scopeLogs ?? []) {
            for (const record of scope.logRecords ?? []) {
              received.logs.push({ body: record.body?.stringValue, traceId: record.traceId });
            }
          }
        }
      }
    } catch {
      // Formato no JSON: se ignora en esta verificación.
    }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end('{}');
  });
});

await new Promise((resolve) => collector.listen(4318, '127.0.0.1', resolve));

process.env.OTEL_ENABLED = 'true';
process.env.NODE_ENV = 'development';
process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://127.0.0.1:4318';
process.env.OTEL_SERVICE_NAME = 'm9-reservas';
process.env.DEPLOYMENT_ENVIRONMENT = 'verificacion-local';

const { telemetry } = await import('../dist/observability/register.js');
const { createApp } = await import('../dist/app.js');
const { createM7StubApp } = await import('../dist/stubs/m7/app.js');
const { log } = await import('../dist/logging/logger.js');

const app = createApp().listen(0);
const m7 = createM7StubApp().listen(0);
const appPort = app.address().port;
const m7Port = m7.address().port;

await fetch(`http://127.0.0.1:${appPort}/health`);
await fetch(`http://127.0.0.1:${appPort}/reservas/00000000-0000-4000-8000-000000000000?x=1`);
// Llamada saliente instrumentada (undici) M9 → m7-stub: debe compartir traceId.
const { withSpan } = await import('../dist/observability/tracing.js');
await withSpan('verificacion.llamada_m7', async () => {
  await fetch(`http://127.0.0.1:${m7Port}/health`);
  log('info', 'verificacion_log_correlacionado', { authorization: 'Bearer no-debe-salir' });
});

await new Promise((resolve) => setTimeout(resolve, 300));
await telemetry.forceFlush();
await telemetry.shutdown();
app.close();
m7.close();
collector.close();

const traceOf = (name) => received.spans.find((span) => span.name === name)?.traceId;
const parentTrace = traceOf('verificacion.llamada_m7');
const sameTrace = received.spans.filter((span) => span.traceId === parentTrace);

console.log(
  JSON.stringify(
    {
      servicios: [...received.resources],
      metricas: [...received.metrics].sort(),
      spans: received.spans.map((span) => span.name),
      trazaM9aM7: sameTrace.map((span) => span.name),
      logs: received.logs.map((entry) => ({
        body: entry.body,
        conTraceId: Boolean(entry.traceId),
      })),
    },
    null,
    2,
  ),
);
