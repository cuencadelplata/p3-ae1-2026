import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { NextFunction, Request, Response } from 'express';
import pg from 'pg';
import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

export type RequirementCode =
  | 'RF8.1'
  | 'RF8.2'
  | 'RF8.3'
  | 'RF8.4'
  | 'RF8.5'
  | 'RF8.6'
  | 'RF8.7'
  | 'M8-CORE';

export interface RouteClassification {
  route: string;
  rf: RequirementCode;
  ignored: boolean;
}

export interface M8MetricsTracker {
  register: Registry;
  httpRequestsTotal: Counter<'method' | 'route' | 'status_code' | 'rf'>;
  httpRequestDurationSeconds: Histogram<'method' | 'route' | 'status_code' | 'rf'>;
  businessOperationsTotal: Counter<'rf' | 'operation' | 'result'>;
  deviceTokensRegisteredTotal: Counter<'platform'>;
  deliveryAttemptsTotal: Counter<'channel' | 'status'>;
  storageSizeBytes: Gauge<'component'>;
  classifyRoute(method: string, pathname: string): RouteClassification;
  middleware(request: Request, response: Response, next: NextFunction): void;
  metricsHandler(request: Request, response: Response): Promise<void>;
  close(): Promise<void>;
}

const IGNORED_PREFIXES = ['/health', '/metrics', '/openapi.yaml', '/docs'];

/**
 * Calcula recursivamente el tamaño en bytes de un directorio en disco.
 */
function calculateDirectorySizeBytes(dirPath: string): number {
  let total = 0;
  try {
    const entries = readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dirPath, entry.name);
      if (entry.isDirectory()) {
        total += calculateDirectorySizeBytes(fullPath);
      } else if (entry.isFile()) {
        total += statSync(fullPath).size;
      }
    }
  } catch {
    // Ignorar directorios sin permisos de lectura
  }
  return total;
}

/**
 * Normaliza la ruta HTTP para evitar explosión de cardinalidad en Grafana Cloud
 * y clasifica cada endpoint según el Requerimiento Funcional (RF8.1 a RF8.7).
 */
export function classifyM8Route(method: string, rawPathname: string): RouteClassification {
  const pathname = rawPathname.split('?')[0] || '/';

  if (IGNORED_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) {
    return { route: pathname, rf: 'M8-CORE', ignored: true };
  }

  // RF8.1 — Notificaciones de viaje
  if (pathname === '/notifications' || pathname.startsWith('/notifications/')) {
    return { route: '/notifications', rf: 'RF8.1', ignored: false };
  }

  // RF8.2 — QR de verificación
  if (pathname === '/qr') {
    return { route: '/qr', rf: 'RF8.2', ignored: false };
  }
  if (pathname === '/qr/validate') {
    return { route: '/qr/validate', rf: 'RF8.2', ignored: false };
  }

  // RF8.4 — Reenvío de comprobante
  if (pathname === '/api/v1/receipts/resend') {
    return { route: '/api/v1/receipts/resend', rf: 'RF8.4', ignored: false };
  }
  if (/^\/api\/v1\/receipts\/[^/]+\/resend$/.test(pathname)) {
    return { route: '/api/v1/receipts/:tripId/resend', rf: 'RF8.4', ignored: false };
  }
  if (/^\/internal\/receipts\/[^/]+\/delivery-reference$/.test(pathname)) {
    return { route: '/internal/receipts/:tripId/delivery-reference', rf: 'RF8.4', ignored: false };
  }

  // RF8.3 — Comprobante PDF
  if (pathname === '/api/v1/receipts') {
    return { route: '/api/v1/receipts', rf: 'RF8.3', ignored: false };
  }
  if (/^\/api\/v1\/receipts\/downloads\/[^/]+$/.test(pathname)) {
    return { route: '/api/v1/receipts/downloads/:token', rf: 'RF8.3', ignored: false };
  }
  if (/^\/api\/v1\/receipts\/[^/]+\/pdf$/.test(pathname)) {
    return { route: '/api/v1/receipts/:tripId/pdf', rf: 'RF8.3', ignored: false };
  }
  if (/^\/api\/v1\/receipts\/[^/]+$/.test(pathname)) {
    return { route: '/api/v1/receipts/:tripId', rf: 'RF8.3', ignored: false };
  }

  // RF8.5 — Soporte asociado a viaje
  if (pathname === '/tickets') {
    return { route: '/tickets', rf: 'RF8.5', ignored: false };
  }
  if (/^\/tickets\/[^/]+\/estado$/.test(pathname)) {
    return { route: '/tickets/:id/estado', rf: 'RF8.5', ignored: false };
  }
  if (/^\/tickets\/[^/]+\/historial$/.test(pathname)) {
    return { route: '/tickets/:id/historial', rf: 'RF8.5', ignored: false };
  }
  if (/^\/tickets\/[^/]+$/.test(pathname)) {
    return { route: '/tickets/:id', rf: 'RF8.5', ignored: false };
  }

  // RF8.6 — Consumo asíncrono / RabbitMQ
  if (pathname === '/events/publish') {
    return { route: '/events/publish', rf: 'RF8.6', ignored: false };
  }

  // RF8.7 — Entrega de notificaciones
  if (pathname === '/devices/tokens') {
    return { route: '/devices/tokens', rf: 'RF8.7', ignored: false };
  }
  if (/^\/devices\/tokens\/[^/]+$/.test(pathname)) {
    return { route: '/devices/tokens/:token', rf: 'RF8.7', ignored: false };
  }
  if (pathname === '/internal/deliveries/simulate') {
    return { route: '/internal/deliveries/simulate', rf: 'RF8.7', ignored: false };
  }
  if (/^\/internal\/deliveries\/[^/]+$/.test(pathname)) {
    return { route: '/internal/deliveries/:notificationId', rf: 'RF8.7', ignored: false };
  }

  if (pathname.startsWith('/test/')) {
    return { route: '/test/:module', rf: 'M8-CORE', ignored: false };
  }

  return { route: `/${method.toLowerCase()}_unmatched`, rf: 'M8-CORE', ignored: false };
}

export function createM8MetricsTracker(serviceName: string = 'm8-app'): M8MetricsTracker {
  const register = new Registry();
  register.setDefaultLabels({ service: serviceName });

  collectDefaultMetrics({ register, prefix: 'nodejs_' });

  const appDiskBytes = calculateDirectorySizeBytes(process.cwd());
  const dbConnectionString =
    process.env.DELIVERY_DATABASE_URL ||
    process.env.RECEIPTS_DATABASE_URL ||
    process.env.NOTIFICATIONS_DATABASE_URL ||
    process.env.SUPPORT_DATABASE_URL;

  let metricsDbPool: pg.Pool | null = null;
  if (dbConnectionString) {
    metricsDbPool = new pg.Pool({
      connectionString: dbConnectionString,
      max: 1,
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 1500,
    });
    metricsDbPool.on('error', () => {
      // Silenciar errores de conexión en segundo plano
    });
  }

  const httpRequestsTotal = new Counter({
    name: 'http_requests_total',
    help: 'Total de peticiones HTTP de negocio atendidas por M8',
    labelNames: ['method', 'route', 'status_code', 'rf'] as const,
    registers: [register],
  });

  const httpRequestDurationSeconds = new Histogram({
    name: 'http_request_duration_seconds',
    help: 'Histograma de latencia de peticiones HTTP de M8 en segundos',
    labelNames: ['method', 'route', 'status_code', 'rf'] as const,
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    registers: [register],
  });

  const businessOperationsTotal = new Counter({
    name: 'm8_business_operations_total',
    help: 'Total de operaciones de dominio ejecutadas por requerimiento funcional en M8',
    labelNames: ['rf', 'operation', 'result'] as const,
    registers: [register],
  });

  const deviceTokensRegisteredTotal = new Counter({
    name: 'm8_device_tokens_registered_total',
    help: 'Total de tokens de dispositivos registrados o actualizados (RF8.7)',
    labelNames: ['platform'] as const,
    registers: [register],
  });

  const deliveryAttemptsTotal = new Counter({
    name: 'm8_notification_delivery_attempts_total',
    help: 'Total de intentos de entrega de notificaciones PUSH (RF8.7)',
    labelNames: ['channel', 'status'] as const,
    registers: [register],
  });

  const storageSizeBytes = new Gauge({
    name: 'm8_storage_size_bytes',
    help: 'Tamaño ocupado en disco por el volumen y contenedor de Módulo 8 en bytes',
    labelNames: ['component'] as const,
    registers: [register],
    async collect() {
      let dbBytes = 0;
      if (metricsDbPool) {
        try {
          const res = await metricsDbPool.query<{ size_bytes: string }>(
            'SELECT pg_database_size(current_database()) AS size_bytes',
          );
          dbBytes = Number(res.rows[0]?.size_bytes ?? 0);
        } catch {
          dbBytes = 0;
        }
      }
      this.set({ component: 'Volumen PostgreSQL (m8-postgres)' }, dbBytes);
      this.set({ component: 'Contenedor Runtime (m8-app)' }, appDiskBytes);
      this.set({ component: 'Volumen Total Módulo 8' }, dbBytes + appDiskBytes);
    },
  });

  function recordBusinessMetrics(
    method: string,
    route: string,
    rf: RequirementCode,
    statusCode: number,
  ): void {
    const isSuccess = statusCode >= 200 && statusCode < 300;
    const fallbackResult = isSuccess ? 'Exitosa' : statusCode >= 500 ? 'Error' : 'Rechazada';

    if (rf === 'RF8.1' && method === 'POST' && route === '/notifications') {
      businessOperationsTotal.inc({
        rf,
        operation: 'Solicitud de notificación',
        result: isSuccess ? 'Procesada' : fallbackResult,
      });
    } else if (rf === 'RF8.2' && method === 'POST' && route === '/qr') {
      businessOperationsTotal.inc({
        rf,
        operation: 'Generación de código QR',
        result: isSuccess ? 'Emitido' : fallbackResult,
      });
    } else if (rf === 'RF8.2' && method === 'POST' && route === '/qr/validate') {
      businessOperationsTotal.inc({
        rf,
        operation: 'Validación de código QR',
        result:
          statusCode === 200
            ? 'Consumido (1er uso)'
            : statusCode === 409
              ? 'Reuso bloqueado (409)'
              : 'Inválido',
      });
    } else if (rf === 'RF8.3' && method === 'POST' && route === '/api/v1/receipts') {
      businessOperationsTotal.inc({
        rf,
        operation: 'Emisión de comprobante',
        result: statusCode === 201 ? 'Creado' : statusCode === 200 ? 'Idempotente' : fallbackResult,
      });
    } else if (rf === 'RF8.3' && method === 'GET' && route === '/api/v1/receipts/:tripId/pdf') {
      businessOperationsTotal.inc({
        rf,
        operation: 'Descarga de comprobante PDF',
        result: isSuccess ? 'Exitosa' : fallbackResult,
      });
    } else if (rf === 'RF8.4' && method === 'POST') {
      businessOperationsTotal.inc({
        rf,
        operation: 'Reenvío de comprobante',
        result: isSuccess ? 'Enviado' : fallbackResult,
      });
    } else if (rf === 'RF8.4' && method === 'GET' && route === '/internal/receipts/:tripId/delivery-reference') {
      businessOperationsTotal.inc({
        rf,
        operation: 'Enlace temporal de reenvío',
        result: isSuccess ? 'Generado' : fallbackResult,
      });
    } else if (rf === 'RF8.5' && method === 'POST' && route === '/tickets') {
      businessOperationsTotal.inc({
        rf,
        operation: 'Creación de ticket de soporte',
        result: isSuccess ? 'Abierto' : fallbackResult,
      });
    } else if (rf === 'RF8.5' && method === 'PATCH' && route === '/tickets/:id/estado') {
      businessOperationsTotal.inc({
        rf,
        operation: 'Actualización de ticket',
        result: isSuccess ? 'Actualizado' : fallbackResult,
      });
    } else if (rf === 'RF8.6' && method === 'POST' && route === '/events/publish') {
      businessOperationsTotal.inc({
        rf,
        operation: 'Publicación en RabbitMQ',
        result: isSuccess ? 'Publicado' : fallbackResult,
      });
    } else if (rf === 'RF8.7' && method === 'POST' && route === '/devices/tokens') {
      businessOperationsTotal.inc({
        rf,
        operation: 'Registro de token Push',
        result: isSuccess ? 'Activo' : fallbackResult,
      });
      if (isSuccess) {
        deviceTokensRegisteredTotal.inc({ platform: 'ANDROID' });
      }
    } else if (rf === 'RF8.7' && method === 'DELETE' && route === '/devices/tokens/:token') {
      businessOperationsTotal.inc({
        rf,
        operation: 'Baja de token Push',
        result: isSuccess ? 'Desactivado' : fallbackResult,
      });
    } else if (rf === 'RF8.7' && method === 'POST' && route === '/internal/deliveries/simulate') {
      businessOperationsTotal.inc({
        rf,
        operation: 'Entrega de notificación Push',
        result: isSuccess ? 'Entregada' : fallbackResult,
      });
      deliveryAttemptsTotal.inc({ channel: 'PUSH', status: isSuccess ? 'DELIVERED' : 'FAILED' });
    }
  }

  return {
    register,
    httpRequestsTotal,
    httpRequestDurationSeconds,
    businessOperationsTotal,
    deviceTokensRegisteredTotal,
    deliveryAttemptsTotal,
    storageSizeBytes,
    classifyRoute: classifyM8Route,
    middleware(request: Request, response: Response, next: NextFunction): void {
      const start = process.hrtime.bigint();
      const method = request.method.toUpperCase();
      const classification = classifyM8Route(method, request.originalUrl || request.url || '/');

      if (!classification.ignored) {
        response.on('finish', () => {
          const durationSeconds = Number(process.hrtime.bigint() - start) / 1e9;
          const statusCode = String(response.statusCode);
          const labels = {
            method,
            route: classification.route,
            status_code: statusCode,
            rf: classification.rf,
          };
          httpRequestsTotal.inc(labels);
          httpRequestDurationSeconds.observe(labels, durationSeconds);
          recordBusinessMetrics(method, classification.route, classification.rf, response.statusCode);
        });
      }

      next();
    },
    async metricsHandler(_request: Request, response: Response): Promise<void> {
      response.setHeader('Content-Type', register.contentType);
      response.status(200).send(await register.metrics());
    },
    async close(): Promise<void> {
      if (metricsDbPool) {
        await metricsDbPool.end();
        metricsDbPool = null;
      }
    },
  };
}

export const defaultM8MetricsTracker = createM8MetricsTracker('m8-app');
