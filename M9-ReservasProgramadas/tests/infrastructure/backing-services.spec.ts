import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { RedisReservationCache } from '../../src/cache/redis-reservation-cache.js';
import type { CrearReserva } from '../../src/domain/reserva.js';
import { PrismaConnection } from '../../src/infrastructure/prisma/prisma.connection.js';
import { RabbitMqConnection } from '../../src/infrastructure/rabbitmq/rabbitmq.connection.js';
import { RedisConnection } from '../../src/infrastructure/redis/redis.connection.js';
import { RedisDistributedLock } from '../../src/locks/redis-distributed-lock.js';
import { createEventEnvelope } from '../../src/messaging/event-envelope.js';
import type { EventPublisher } from '../../src/messaging/event-publisher.js';
import { OutboxProcessor } from '../../src/messaging/outbox.processor.js';
import {
  IdempotentEventHandler,
  type ProcessedEventRepository,
} from '../../src/messaging/processed-event.repository.js';
import { RabbitMqConsumer } from '../../src/messaging/rabbitmq-consumer.js';
import { RabbitMqEventPublisher } from '../../src/messaging/rabbitmq-event-publisher.js';
import {
  RESERVATION_EVENT_TYPES,
  type DispatchResultEvent,
} from '../../src/messaging/reservation-events.js';
import { PrismaDispatchOperationStore } from '../../src/repositories/prisma-dispatch-operation.store.js';
import { PrismaDispatchResultProcessor } from '../../src/repositories/prisma-dispatch-result.processor.js';
import { PrismaOutboxRepository } from '../../src/repositories/prisma-outbox.repository.js';
import { PrismaReservaRepository } from '../../src/repositories/prisma-reserva.repository.js';

const suffix = randomUUID();
const redis = new RedisConnection(process.env.REDIS_URL ?? 'redis://localhost:6379');
const postgres = new PrismaConnection(process.env.DATABASE_URL);
const reservationIds: string[] = [];
const rabbit = new RabbitMqConnection(
  process.env.RABBITMQ_URL ?? 'amqp://m9:m9-local@localhost:5672',
  {
    exchange: `m9.tests.${suffix}`,
    retryExchange: `m9.tests.${suffix}.retry`,
    deadLetterExchange: `m9.tests.${suffix}.dlx`,
    queue: `m9.tests.${suffix}`,
    retryQueue: `m9.tests.${suffix}.retry`,
    deadLetterQueue: `m9.tests.${suffix}.dlq`,
    retryDelayMs: 50,
  },
);

beforeAll(async () => {
  await postgres.connect();
  await redis.connect();
  await rabbit.connect();
});

afterAll(async () => {
  await postgres.client.inboxEvent.deleteMany({ where: { aggregateId: { in: reservationIds } } });
  await postgres.client.outboxEvent.deleteMany({ where: { aggregateId: { in: reservationIds } } });
  await postgres.client.reservation.deleteMany({ where: { id: { in: reservationIds } } });
  const channel = rabbit.getChannel();
  await channel.deleteQueue(rabbit.topology.queue);
  await channel.deleteQueue(rabbit.topology.retryQueue);
  await channel.deleteQueue(rabbit.topology.deadLetterQueue);
  await channel.deleteExchange(rabbit.topology.exchange);
  await channel.deleteExchange(rabbit.topology.retryExchange);
  await channel.deleteExchange(rabbit.topology.deadLetterExchange);
  await rabbit.close();
  await redis.close();
  await postgres.close();
});

const reservationInput = (): CrearReserva => ({
  clienteId: randomUUID(),
  origen: 'Terminal de infraestructura',
  destino: 'Aeropuerto de infraestructura',
  vehiculo: 'AUTO',
  fechaHoraProgramada: new Date(Date.now() + 60_000).toISOString(),
  tarifaEstimada: 1_000,
  moneda: 'ARS',
  estimacionTarifaId: randomUUID(),
  routeSnapshot: {
    origin: { latitude: -27.45, longitude: -58.98, address: 'Terminal' },
    destination: { latitude: -27.47, longitude: -58.83, address: 'Aeropuerto' },
    distanceKm: 18.4,
    estimatedDurationMin: 28,
  },
});

const track = <T extends { id: string }>(reservation: T): T => {
  reservationIds.push(reservation.id);
  return reservation;
};

describe('backing services reales', () => {
  it('guarda, invalida y expira caché en Redis', async () => {
    const cache = new RedisReservationCache(redis.client, 1);
    const reserva = {
      id: randomUUID(),
      clienteId: randomUUID(),
      origen: 'A',
      destino: 'B',
      vehiculo: 'AUTO' as const,
      fechaHoraProgramada: new Date(Date.now() + 60_000).toISOString(),
      estado: 'PROGRAMADA' as const,
      tarifaEstimada: 100,
      moneda: 'ARS',
      estimacionTarifaId: 'est_infrastructure_test',
      routeSnapshot: null,
      criterioAsignacion: null,
      idSolicitud: null,
      assignedDriverId: null,
      creadoEn: new Date().toISOString(),
      actualizadoEn: new Date().toISOString(),
    };
    await cache.set(reserva);
    expect(await cache.get(reserva.id)).toEqual(reserva);
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    expect(await cache.get(reserva.id)).toBeNull();
    await cache.set(reserva);
    await cache.invalidate(reserva.id);
    expect(await cache.get(reserva.id)).toBeNull();
  });

  it('rechaza un lock duplicado y permite adquirirlo tras liberar', async () => {
    const lock = new RedisDistributedLock(redis.client, 2_000);
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = lock.runExclusive(`lock:test:${suffix}`, () => waiting);
    await new Promise((resolve) => setTimeout(resolve, 50));
    await expect(
      lock.runExclusive(`lock:test:${suffix}`, async () => undefined),
    ).rejects.toMatchObject({ code: 'RESERVA_EN_PROCESO' });
    release();
    await first;
    await expect(lock.runExclusive(`lock:test:${suffix}`, async () => 'ok')).resolves.toBe('ok');
  });

  it('no libera un lock cuyo token cambió y permite recuperar uno expirado', async () => {
    const ownershipKey = `lock:ownership:${suffix}`;
    const ownershipLock = new RedisDistributedLock(redis.client, 2_000);
    let releaseOwner!: () => void;
    const ownerWaiting = new Promise<void>((resolve) => {
      releaseOwner = resolve;
    });
    const owner = ownershipLock.runExclusive(ownershipKey, () => ownerWaiting);
    await new Promise((resolve) => setTimeout(resolve, 50));
    await redis.client.set(ownershipKey, 'replacement-token', {
      expiration: { type: 'PX', value: 2_000 },
    });
    releaseOwner();
    await owner;
    expect(await redis.client.get(ownershipKey)).toBe('replacement-token');
    await redis.client.del(ownershipKey);

    const expiryKey = `lock:expiry:${suffix}`;
    const expiringLock = new RedisDistributedLock(redis.client, 100);
    let finishFirst!: () => void;
    const firstWaiting = new Promise<void>((resolve) => {
      finishFirst = resolve;
    });
    const first = expiringLock.runExclusive(expiryKey, () => firstWaiting);
    await new Promise((resolve) => setTimeout(resolve, 150));
    await expect(expiringLock.runExclusive(expiryKey, async () => 'recovered')).resolves.toBe(
      'recovered',
    );
    finishFirst();
    await first;
  });

  it('publica con confirmación y envía mensajes a la DLQ', async () => {
    const channel = rabbit.getChannel();
    await channel.bindQueue(rabbit.topology.queue, rabbit.topology.exchange, 'test.#');
    const publisher = new RabbitMqEventPublisher(rabbit);
    const event = createEventEnvelope({
      eventType: 'PROVISIONAL_INFRA_TEST',
      correlationId: suffix,
      aggregateId: 'reserva-test',
      payload: { ok: true },
    });
    await publisher.publish('test.created', event);
    const delivered = await channel.get(rabbit.topology.queue, { noAck: true });
    expect(delivered).not.toBe(false);

    await publisher.publishToDeadLetter('test.failed', event);
    const deadLetter = await channel.get(rabbit.topology.deadLetterQueue, { noAck: true });
    expect(deadLetter).not.toBe(false);
  });

  it('consume y descarta de forma idempotente un eventId duplicado', async () => {
    const processed = new Set<string>();
    const repository: ProcessedEventRepository = {
      hasProcessed: async (id) => processed.has(id),
      markProcessed: async (id) => {
        processed.add(id);
      },
    };
    const consumer = new RabbitMqConsumer(rabbit, 3, new IdempotentEventHandler(repository));
    let effects = 0;
    await consumer.start(['consumer.#'], async () => {
      effects += 1;
    });
    const event = createEventEnvelope({
      eventType: 'PROVISIONAL_CONSUMER_TEST',
      correlationId: suffix,
      aggregateId: 'reserva-consumer-test',
      payload: { ok: true },
    });
    const publisher = new RabbitMqEventPublisher(rabbit);
    await publisher.publish('consumer.received', event);
    await publisher.publish('consumer.received', event);

    const deadline = Date.now() + 2_000;
    while (Date.now() < deadline) {
      const state = await rabbit.getChannel().checkQueue(rabbit.topology.queue);
      if (state.messageCount === 0 && effects === 1) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    expect(effects).toBe(1);
  });

  it('conserva reserva, Idempotency-Key y Outbox tras reconectar Prisma', async () => {
    const firstConnection = new PrismaConnection(process.env.DATABASE_URL);
    await firstConnection.connect();
    const created = track(
      await new PrismaReservaRepository(firstConnection.client).crear(reservationInput()),
    );
    const firstKey = await new PrismaDispatchOperationStore(firstConnection.client).getOrCreate(
      created.id,
    );
    await firstConnection.close();

    const secondConnection = new PrismaConnection(process.env.DATABASE_URL);
    await secondConnection.connect();
    const recovered = await new PrismaReservaRepository(secondConnection.client).obtenerPorId(
      created.id,
    );
    const recoveredKey = await new PrismaDispatchOperationStore(
      secondConnection.client,
    ).getOrCreate(created.id);
    const outbox = await secondConnection.client.outboxEvent.findFirst({
      where: { aggregateId: created.id },
    });
    await secondConnection.close();

    expect(recovered).toMatchObject({ id: created.id, estado: 'PROGRAMADA' });
    expect(recoveredKey).toBe(firstKey);
    expect(outbox).toMatchObject({ status: 'PENDING', attempts: 0 });
  });

  it('procesa una asignación una sola vez con dos consumidores Prisma', async () => {
    const repository = new PrismaReservaRepository(postgres.client);
    const created = track(await repository.crear(reservationInput()));
    await repository.cambiarEstado(created.id, 'PROGRAMADA', 'ACTIVANDO', {
      routeSnapshot: created.routeSnapshot,
    });
    const event = {
      ...createEventEnvelope({
        eventType: RESERVATION_EVENT_TYPES.rideAssigned,
        correlationId: suffix,
        aggregateId: created.id,
        payload: {
          reservationId: created.id,
          requestId: randomUUID(),
          assignedDriverId: randomUUID(),
        },
      }),
      eventType: RESERVATION_EVENT_TYPES.rideAssigned,
    } satisfies DispatchResultEvent;
    const otherConnection = new PrismaConnection(process.env.DATABASE_URL);
    await otherConnection.connect();
    const results = await Promise.all([
      new PrismaDispatchResultProcessor(postgres.client).process(event),
      new PrismaDispatchResultProcessor(otherConnection.client).process(event),
    ]);
    await otherConnection.close();

    expect(results.sort()).toEqual(['DUPLICATE', 'PROCESSED']);
    expect(await postgres.client.inboxEvent.count({ where: { eventId: event.eventId } })).toBe(1);
    expect(await repository.obtenerPorId(created.id)).toMatchObject({ estado: 'ACTIVADA' });
  });

  it('resuelve cancelación contra activación con una transición condicional', async () => {
    const firstRepository = new PrismaReservaRepository(postgres.client);
    const created = track(await firstRepository.crear(reservationInput()));
    const otherConnection = new PrismaConnection(process.env.DATABASE_URL);
    await otherConnection.connect();
    const secondRepository = new PrismaReservaRepository(otherConnection.client);
    const [cancelled, activating] = await Promise.all([
      firstRepository.cancelar(created.id, 'PROGRAMADA'),
      secondRepository.cambiarEstado(created.id, 'PROGRAMADA', 'ACTIVANDO', {
        routeSnapshot: created.routeSnapshot,
      }),
    ]);
    await otherConnection.close();

    expect([cancelled, activating].filter((result) => result !== null)).toHaveLength(1);
    const finalState = await firstRepository.obtenerPorId(created.id);
    expect(['CANCELADA', 'ACTIVANDO']).toContain(finalState?.estado);
  });

  it('mantiene Outbox PENDING ante fallo y publica al recuperarse RabbitMQ', async () => {
    const repository = new PrismaReservaRepository(postgres.client);
    const created = track(await repository.crear(reservationInput()));
    const outboxRepository = new PrismaOutboxRepository(postgres.client);
    const unavailablePublisher: EventPublisher = {
      publish: async () => Promise.reject(new Error('rabbit unavailable')),
      publishToDeadLetter: async () => Promise.reject(new Error('rabbit unavailable')),
    };
    await new OutboxProcessor(outboxRepository, unavailablePublisher, 3, 0).process();
    expect(
      await postgres.client.outboxEvent.findFirst({ where: { aggregateId: created.id } }),
    ).toMatchObject({ status: 'PENDING', attempts: 1 });

    await new OutboxProcessor(outboxRepository, new RabbitMqEventPublisher(rabbit), 3, 0).process();
    expect(
      await postgres.client.outboxEvent.findFirst({ where: { aggregateId: created.id } }),
    ).toMatchObject({ status: 'PUBLISHED' });
  });

  it('reintenta y deriva a DLQ después del límite configurado', async () => {
    const retrySuffix = randomUUID();
    const isolated = new RabbitMqConnection(
      process.env.RABBITMQ_URL ?? 'amqp://m9:m9-local@localhost:5672',
      {
        exchange: `m9.retry.${retrySuffix}`,
        retryExchange: `m9.retry.${retrySuffix}.retry`,
        deadLetterExchange: `m9.retry.${retrySuffix}.dlx`,
        queue: `m9.retry.${retrySuffix}`,
        retryQueue: `m9.retry.${retrySuffix}.retry`,
        deadLetterQueue: `m9.retry.${retrySuffix}.dlq`,
        retryDelayMs: 25,
      },
    );
    await isolated.connect();
    const consumer = new RabbitMqConsumer(isolated, 2);
    await consumer.start(['retry.#'], async () => Promise.reject(new Error('poison')));
    const poison = createEventEnvelope({
      eventType: 'reservation.poisoned.v1',
      correlationId: retrySuffix,
      aggregateId: randomUUID(),
      payload: { invalid: true },
    });
    await new RabbitMqEventPublisher(isolated).publish('retry.poison', poison);

    let deadLetter: Awaited<ReturnType<ReturnType<typeof isolated.getChannel>['get']>> = false;
    const deadline = Date.now() + 3_000;
    while (deadLetter === false && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
      deadLetter = await isolated.getChannel().get(isolated.topology.deadLetterQueue, {
        noAck: true,
      });
    }
    expect(deadLetter).not.toBe(false);
    if (deadLetter !== false) {
      expect(deadLetter.properties.headers?.['x-retry-count']).toBe(2);
    }

    const channel = isolated.getChannel();
    await channel.deleteQueue(isolated.topology.queue);
    await channel.deleteQueue(isolated.topology.retryQueue);
    await channel.deleteQueue(isolated.topology.deadLetterQueue);
    await channel.deleteExchange(isolated.topology.exchange);
    await channel.deleteExchange(isolated.topology.retryExchange);
    await channel.deleteExchange(isolated.topology.deadLetterExchange);
    await isolated.close();
  });
});
