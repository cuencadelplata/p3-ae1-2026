import { randomUUID } from 'node:crypto';

import { context, ROOT_CONTEXT, SpanKind, trace } from '@opentelemetry/api';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../../src/app.js';
import { RedisReservationCache } from '../../src/cache/redis-reservation-cache.js';
import { ExternalServiceError } from '../../src/errors/external-service.error.js';
import type { RedisClient } from '../../src/infrastructure/redis/redis.connection.js';
import { log } from '../../src/logging/logger.js';
import { createEventEnvelope } from '../../src/messaging/event-envelope.js';
import { OutboxProcessor } from '../../src/messaging/outbox.processor.js';
import type { OutboxMessage, OutboxRepository } from '../../src/messaging/outbox.repository.js';
import { RESERVATION_EVENT_TYPES } from '../../src/messaging/reservation-events.js';
import { normalizeRoute } from '../../src/observability/http-telemetry.js';
import { resetObservedStateForTests } from '../../src/observability/metrics.js';
import { isValidCorrelationId, redact } from '../../src/observability/redaction.js';
import { StateMetricsCollector } from '../../src/observability/state-collector.js';
import {
  extractTraceContext,
  injectTraceContext,
  persistableTraceContext,
  withSpan,
} from '../../src/observability/tracing.js';
import { PrismaDispatchResultProcessor } from '../../src/repositories/prisma-dispatch-result.processor.js';
import { InMemoryReservaRepository } from '../../src/repositories/in-memory-reserva.repository.js';
import { outboxData } from '../../src/repositories/prisma-reserva.repository.js';
import { ReservaService } from '../../src/services/reserva.service.js';
import { fareEstimate, routeResolverDemo } from '../helpers/route.js';
import { setupTestTelemetry, type TestTelemetry } from '../helpers/telemetry.js';

const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

let telemetry: TestTelemetry;

beforeAll(() => {
  telemetry = setupTestTelemetry();
});

afterAll(async () => {
  await telemetry.shutdown();
});

beforeEach(() => {
  telemetry.spans.reset();
  telemetry.resetLogs();
  resetObservedStateForTests();
});

describe('normalización de rutas HTTP', () => {
  it('reemplaza UUID por :id y descarta la query string', () => {
    expect(normalizeRoute(`/reservas/${randomUUID()}?token=secreto`, 200)).toEqual({
      route: '/reservas/:id',
      kind: 'business',
    });
    expect(normalizeRoute('/reservas?page=2', 200)).toEqual({
      route: '/reservas',
      kind: 'business',
    });
  });

  it('separa health/docs y agrupa rutas desconocidas sin crear series nuevas', () => {
    expect(normalizeRoute('/readiness', 503).kind).toBe('health');
    expect(normalizeRoute('/docs/swagger-ui.css', 200)).toEqual({ route: '/docs', kind: 'docs' });
    expect(normalizeRoute(`/${randomUUID()}/x`, 404)).toEqual({
      route: 'unmatched',
      kind: 'unmatched',
    });
  });
});

describe('redacción de datos sensibles', () => {
  it('oculta credenciales, direcciones y coordenadas pero conserva IDs controlados', () => {
    const reservaId = randomUUID();
    const result = redact({
      authorization: 'Bearer abc.def.ghi',
      reservaId,
      origen: 'Av. Siempre Viva 742',
      route: '/reservas/:id',
      nested: { latitude: -27.4, url: 'amqp://m9:clave@rabbitmq:5672' },
      note: 'token Bearer abc.def.ghi en texto',
    });

    expect(result).toMatchObject({
      authorization: '[REDACTED]',
      reservaId,
      origen: '[REDACTED]',
      route: '/reservas/:id',
      nested: { latitude: '[REDACTED]', url: 'amqp://[REDACTED]@rabbitmq:5672' },
    });
    expect(JSON.stringify(result)).not.toContain('abc.def.ghi');
    expect(JSON.stringify(result)).not.toContain('clave');
  });

  it('valida el correlationId entrante', () => {
    expect(isValidCorrelationId('req-123:abc')).toBe(true);
    expect(isValidCorrelationId('a'.repeat(129))).toBe(false);
    expect(isValidCorrelationId('<script>')).toBe(false);
    expect(isValidCorrelationId(undefined)).toBe(false);
  });
});

describe('telemetría HTTP', () => {
  it('registra duración con ruta normalizada y continúa un traceparent entrante', async () => {
    const traceId = '4bf92f3577b34da6a3ce929d0e0e4736';
    const id = randomUUID();
    const before = await telemetry.metricValue('http.server.request.duration', {
      'http.route': '/reservas/:id',
    });

    await request(createApp())
      .get(`/reservas/${id}?secret=1`)
      .set('traceparent', `00-${traceId}-00f067aa0ba902b7-01`);

    const after = await telemetry.metricValue('http.server.request.duration', {
      'http.route': '/reservas/:id',
      'http.response.status_code': 404,
    });
    expect(after - before).toBe(1);

    const points = await telemetry.metricPoints('http.server.request.duration');
    expect(JSON.stringify(points.map((point) => point.attributes))).not.toMatch(UUID_PATTERN);

    const span = telemetry.spans.getFinishedSpans().find((item) => item.kind === SpanKind.SERVER);
    expect(span?.name).toBe('GET /reservas/:id');
    expect(span?.spanContext().traceId).toBe(traceId);
  });

  it('separa health de las operaciones de negocio', async () => {
    await request(createApp()).get('/health');
    expect(
      await telemetry.metricValue('http.server.request.duration', { 'm9.route.kind': 'health' }),
    ).toBeGreaterThan(0);
  });
});

describe('logs correlacionados', () => {
  it('incluye trace_id/span_id y exporta por OTLP sin secretos', async () => {
    const write = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    let traceId = '';
    await withSpan('test.log', async (span) => {
      traceId = span.spanContext().traceId;
      log('info', 'evento_prueba', { authorization: 'Bearer secreto', reservaId: 'r-1' });
    });
    const line = JSON.parse(write.mock.calls[0]?.[0] as string) as Record<string, unknown>;
    write.mockRestore();

    expect(line).toMatchObject({
      message: 'evento_prueba',
      trace_id: traceId,
      authorization: '[REDACTED]',
      service: 'm9-reservas',
    });
    const record = telemetry.logRecords().find((item) => item.body === 'evento_prueba');
    expect(record?.spanContext?.traceId).toBe(traceId);
    expect(JSON.stringify(record?.attributes)).not.toContain('secreto');
  });
});

describe('contexto de traza persistido en el Outbox', () => {
  const event = () =>
    createEventEnvelope({
      eventType: RESERVATION_EVENT_TYPES.created,
      correlationId: 'corr-1',
      aggregateId: randomUUID(),
      payload: { reservationId: randomUUID(), status: 'PROGRAMADA' },
    });

  it('captura traceparent al crear el evento y lo omite sin span activo', async () => {
    let created: ReturnType<typeof outboxData> | undefined;
    let traceId = '';
    await withSpan('http.create', async (span) => {
      traceId = span.spanContext().traceId;
      created = outboxData('reservation.created.v1', event());
    });
    expect(String((created?.traceContext as Record<string, string>).traceparent)).toContain(
      traceId,
    );

    const withoutSpan = context.with(ROOT_CONTEXT, () => persistableTraceContext());
    expect(withoutSpan).toBeNull();
  });

  it('publica continuando la traza original, incluso tras reiniciar el proceso', async () => {
    let storedContext: Record<string, string> = {};
    let originalTraceId = '';
    await withSpan('http.create', async (span) => {
      originalTraceId = span.spanContext().traceId;
      storedContext = injectTraceContext();
    });
    // Simula lectura desde PostgreSQL en otro proceso: solo queda el JSON persistido.
    const persisted = JSON.parse(JSON.stringify(storedContext)) as Record<string, string>;

    const published: string[] = [];
    const message: OutboxMessage = {
      id: randomUUID(),
      routingKey: 'reservation.created.v1',
      event: event(),
      status: 'PENDING',
      attempts: 0,
      traceContext: persisted,
    };
    const legacy: OutboxMessage = { ...message, id: randomUUID(), traceContext: null };
    const repository: OutboxRepository = {
      findPending: async () => [message, legacy],
      markPublished: async () => undefined,
      markFailed: async () => undefined,
      scheduleRetry: async () => undefined,
    };
    const publisher = {
      publish: async () => {
        published.push(trace.getActiveSpan()?.spanContext().traceId ?? '');
      },
      publishToDeadLetter: async () => undefined,
    };

    await new OutboxProcessor(repository, publisher, 3, 0).process();

    expect(published[0]).toBe(originalTraceId);
    expect(published[1]).not.toBe(originalTraceId);
    const producer = telemetry.spans
      .getFinishedSpans()
      .filter((span) => span.kind === SpanKind.PRODUCER);
    expect(producer).toHaveLength(2);
    expect(producer[0]?.links).toHaveLength(1);
  });

  it('recupera el contexto desde headers AMQP (Buffer o string)', () => {
    const traceparent = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';
    const fromBuffer = extractTraceContext({ traceparent: Buffer.from(traceparent) });
    expect(trace.getSpanContext(fromBuffer)?.traceId).toBe('4bf92f3577b34da6a3ce929d0e0e4736');
    expect(trace.getSpanContext(extractTraceContext(undefined))).toBeUndefined();
  });
});

describe('métricas de negocio contadas tras el commit', () => {
  const input = () => ({
    clienteId: randomUUID(),
    origen: 'A',
    destino: 'B',
    vehiculo: 'AUTO' as const,
    fechaHoraProgramada: new Date(Date.now() + 3_600_000).toISOString(),
  });

  it('cuenta la creación exitosa y la degradación de tarifa con causa acotada', async () => {
    const service = new ReservaService(
      new InMemoryReservaRepository(),
      {
        estimar: async () => {
          throw ExternalServiceError.timeout('M7');
        },
      },
      routeResolverDemo(),
    );
    const created = { operation: 'create', result: 'success' };
    const degraded = { operation: 'create', cause: 'm7_timeout' };
    const beforeCreated = await telemetry.metricValue('m9.reservation.operations', created);
    const beforeDegraded = await telemetry.metricValue(
      'm9.reservation.pricing.degradations',
      degraded,
    );

    await expect(service.crear(input())).resolves.toMatchObject({ tarifaEstimada: null });

    expect(await telemetry.metricValue('m9.reservation.operations', created)).toBe(
      beforeCreated + 1,
    );
    expect(await telemetry.metricValue('m9.reservation.pricing.degradations', degraded)).toBe(
      beforeDegraded + 1,
    );
  });

  it('no cuenta como éxito una operación rechazada', async () => {
    const service = new ReservaService(
      new InMemoryReservaRepository(),
      { estimar: async () => fareEstimate() },
      routeResolverDemo(),
    );
    const success = { operation: 'create', result: 'success' };
    const before = await telemetry.metricValue('m9.reservation.operations', success);

    await expect(
      service.crear({ ...input(), fechaHoraProgramada: '2000-01-01T00:00:00.000Z' }),
    ).rejects.toMatchObject({ code: 'FECHA_INVALIDA' });

    expect(await telemetry.metricValue('m9.reservation.operations', success)).toBe(before);
    expect(
      await telemetry.metricValue('m9.reservation.operations', {
        result: 'rejected',
        reason: 'FECHA_INVALIDA',
      }),
    ).toBeGreaterThan(0);
  });

  const inboxEvent = () => ({
    eventId: randomUUID(),
    eventType: RESERVATION_EVENT_TYPES.rideAssigned,
    eventVersion: 1 as const,
    occurredAt: new Date().toISOString(),
    correlationId: 'corr-inbox',
    aggregateId: randomUUID(),
    payload: {
      reservationId: randomUUID(),
      requestId: randomUUID(),
      assignedDriverId: randomUUID(),
    },
  });

  const prismaWith = (claimed: number, updated: number, fail = false) => {
    const transaction = {
      inboxEvent: { createMany: async () => ({ count: claimed }) },
      reservation: {
        updateMany: async () => ({ count: updated }),
        findUniqueOrThrow: async () => ({
          id: randomUUID(),
          status: 'ACTIVADA',
          scheduledAt: new Date(Date.now() - 30_000),
        }),
      },
      outboxEvent: { create: async () => ({}) },
    };
    return {
      $transaction: async (action: (tx: typeof transaction) => Promise<unknown>) => {
        const result = await action(transaction);
        if (fail) throw new Error('rollback');
        return result;
      },
    } as never;
  };

  it('Inbox: PROCESSED registra la activación final; DUPLICATE y rollback no', async () => {
    const transition = { from: 'ACTIVANDO', to: 'ACTIVADA' };
    const before = await telemetry.metricValue('m9.reservation.transitions', transition);

    await expect(
      new PrismaDispatchResultProcessor(prismaWith(0, 0)).process(inboxEvent()),
    ).resolves.toBe('DUPLICATE');
    await expect(
      new PrismaDispatchResultProcessor(prismaWith(1, 1, true)).process(inboxEvent()),
    ).rejects.toThrow('rollback');
    expect(await telemetry.metricValue('m9.reservation.transitions', transition)).toBe(before);

    await expect(
      new PrismaDispatchResultProcessor(prismaWith(1, 1)).process(inboxEvent()),
    ).resolves.toBe('PROCESSED');
    expect(await telemetry.metricValue('m9.reservation.transitions', transition)).toBe(before + 1);
    expect(
      await telemetry.metricValue('m9.reservation.activation.resolution', {
        result: 'ACTIVADA',
        path: 'events',
      }),
    ).toBeGreaterThan(0);
    expect(
      await telemetry.metricValue('m9.inbox.results', { result: 'DUPLICATE' }),
    ).toBeGreaterThan(0);
  });
});

describe('caché Redis', () => {
  it('distingue bypass (Redis caído) de miss y hit', async () => {
    const store = new Map<string, string>();
    const client = {
      isReady: true,
      get: async (key: string) => store.get(key) ?? null,
    } as unknown as RedisClient;
    const cache = new RedisReservationCache(client, 60, () => undefined);
    const downCache = new RedisReservationCache(
      { isReady: false } as unknown as RedisClient,
      60,
      () => undefined,
    );
    const before = {
      miss: await telemetry.metricValue('m9.cache.requests', { result: 'miss' }),
      bypass: await telemetry.metricValue('m9.cache.requests', { result: 'bypass' }),
    };

    await cache.get(randomUUID());
    await downCache.get(randomUUID());

    expect(await telemetry.metricValue('m9.cache.requests', { result: 'miss' })).toBe(
      before.miss + 1,
    );
    expect(await telemetry.metricValue('m9.cache.requests', { result: 'bypass' })).toBe(
      before.bypass + 1,
    );
  });
});

describe('recolector de estado', () => {
  const snapshot = {
    reservationsByStatus: { PROGRAMADA: 2, ACTIVANDO: 1, ACTIVADA: 0, CANCELADA: 0, FALLIDA: 0 },
    overduePending: 1,
    oldestOverdueSeconds: 12,
    stuckActivating: 0,
    oldestActivatingSeconds: 3,
    outboxPending: 4,
    outboxOldestPendingSeconds: 7,
    outboxFailed: 0,
  };

  it('publica valores agregados cuando la consulta funciona', async () => {
    await new StateMetricsCollector({
      intervalMs: 15_000,
      database: async () => snapshot,
    }).collect();
    expect(await telemetry.metricValue('m9.outbox.pending')).toBe(4);
    expect(await telemetry.metricValue('m9.state_collector.up', { source: 'database' })).toBe(1);
  });

  it('ante una falla NO reporta un falso cero: la serie queda ausente', async () => {
    await new StateMetricsCollector({
      intervalMs: 15_000,
      database: async () => {
        throw new Error('PostgreSQL caído');
      },
    }).collect();
    expect(await telemetry.metricPoints('m9.outbox.pending')).toHaveLength(0);
    expect(await telemetry.metricValue('m9.state_collector.up', { source: 'database' })).toBe(0);
  });
});
