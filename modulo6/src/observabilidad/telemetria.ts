// Trazas y logs OpenTelemetry de M6 (RNF-13 / RNF-19).
// Se carga antes que la aplicación con `node --import ./dist/src/observabilidad/telemetria.js`,
// para que las instrumentaciones de http, express, pg, ioredis, amqplib, fetch (undici) y pino
// se apliquen al cargar esos módulos. Sin OTEL_EXPORTER_OTLP_ENDPOINT no hace nada (tests, local).
import { register } from 'node:module';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { Resource } from '@opentelemetry/resources';
import { BatchLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { NodeSDK } from '@opentelemetry/sdk-node';

const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

if (endpoint) {
    // Hook ESM: el código compilado de M6 es un módulo ES.
    register('@opentelemetry/instrumentation/hook.mjs', import.meta.url);

    const sdk = new NodeSDK({
        resource: new Resource({
            'service.name': process.env.OTEL_SERVICE_NAME ?? 'm6-viajes',
            'service.namespace': 'movilidad',
            'service.version': process.env.npm_package_version ?? '1.0.0',
            'deployment.environment': process.env.DEPLOY_ENV ?? 'local',
            'm6.modulo': 'M6',
        }),
        traceExporter: new OTLPTraceExporter({ url: `${endpoint.replace(/\/+$/, '')}/v1/traces` }),
        logRecordProcessors: [
            new BatchLogRecordProcessor(new OTLPLogExporter({ url: `${endpoint.replace(/\/+$/, '')}/v1/logs` })),
        ],
        instrumentations: [
            getNodeAutoInstrumentations({
                // El sistema de archivos y DNS sólo agregan ruido a las trazas.
                '@opentelemetry/instrumentation-fs': { enabled: false },
                '@opentelemetry/instrumentation-dns': { enabled: false },
                '@opentelemetry/instrumentation-net': { enabled: false },
                // No trazar los scrapes de métricas ni los healthchecks.
                '@opentelemetry/instrumentation-http': {
                    ignoreIncomingRequestHook: (request) =>
                        request.url === '/metrics' || request.url === '/health',
                },
            }),
        ],
    });

    sdk.start();
    const apagar = () => {
        void sdk.shutdown().catch(() => undefined);
    };
    process.once('SIGTERM', apagar);
    process.once('SIGINT', apagar);
}
