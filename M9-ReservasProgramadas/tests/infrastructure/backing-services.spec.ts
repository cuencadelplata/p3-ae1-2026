import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { RedisReservationCache } from '../../src/cache/redis-reservation-cache.js';
import type { CrearReserva } from '../../src/domain/reserva.js';
import { PrismaConnection } from '../../src/infrastructure/prisma/prisma.connection.js';
import { RabbitMqConnection } from '../../src/infrastructure/rabbitmq/rabbitmq.connection.js';
import { RedisConnection } from '../../src/infrastructure/redis/redis.connection.js';
import { runWithRequestContext } from '../../src/integration/request-context.js';
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

if (!/^m9-infrastructure-tests-[a-f0-9]{8}$/.test(process.env.M9_TEST_INFRA_PROJECT ?? ''))
  throw new Error(
    'Usar npm run test:infrastructure o npm run test:coverage:infra para aislar los datos.',
  );
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
  it('solo un claim gana entre 32 activaciones concurrentes y comparten clave durable', async () => {
    const repository = new PrismaReservaRepository(postgres.client);
    const created = track(await repository.crear(reservationInput()));
    const results = await Promise.all(
      Array.from({ length: 32 }, () =>
        repository.cambiarEstado(created.id, 'PROGRAMADA', 'ACTIVANDO'),
      ),
    );
    expect(results.filter(Boolean)).toHaveLength(1);
    const store = new PrismaDispatchOperationStore(postgres.client);
    const keys = await Promise.all(Array.from({ length: 32 }, () => store.getOrCreate(created.id)));
    expect(new Set(keys).size).toBe(1);
  });

  it('recupera claim y clave tras SIGKILL de un proceso independiente', async () => {
    const repository = new PrismaReservaRepository(postgres.client);
    const created = track(await repository.crear(reservationInput()));
    const crashKey = randomUUID();
    const code = `
      import { PrismaClient } from '@prisma/client';
      const p = new PrismaClient();
      await p.reservation.update({where:{id:process.env.CRASH_RESERVATION_ID},data:{status:'ACTIVANDO',dispatchIdempotencyKey:process.env.CRASH_KEY,updatedAt:new Date(Date.now()-180000)}});
      console.log('CLAIM_PERSISTED');
      setInterval(()=>{},1000);
    `;
    const child = spawn(process.execPath, ['--input-type=module', '-e', code], {
      env: { ...process.env, CRASH_RESERVATION_ID: created.id, CRASH_KEY: crashKey },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('El proceso no persistio el claim')), 8000);
        child.once('error', reject);
        child.stdout.on('data', (data: Buffer) => {
          if (data.toString().includes('CLAIM_PERSISTED')) {
            clearTimeout(timer);
            resolve();
          }
        });
      });
      const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
      child.kill('SIGKILL');
      await exited;
      expect(await repository.recuperarActivacion(created.id, new Date(Date.now() - 120000))).toBe(
        true,
      );
      expect(await new PrismaDispatchOperationStore(postgres.client).getOrCreate(created.id)).toBe(
        crashKey,
      );
      expect(await repository.obtenerPorId(created.id)).toMatchObject({ estado: 'PROGRAMADA' });
    } finally {
      child.kill('SIGKILL');
    }
  });
  it('persiste identidades numericas y filtra por propietario antes de paginar', async () => {
    const repository = new PrismaReservaRepository(postgres.client);
    const one = track(await repository.crear({ ...reservationInput(), clienteId: '101' }));
    track(await repository.crear({ ...reservationInput(), clienteId: '202' }));
    const two = track(await repository.crear({ ...reservationInput(), clienteId: '101' }));
    const rows = await repository.listarPaginado(1, 100, '101');
    expect(rows.map((r) => r.id).sort()).toEqual([one.id, two.id].sort());
    expect((await repository.listarPaginado(2, 1, '101'))[0]?.clienteId).toBe('101');
  });
  it('recupera el claim abandonado con CAS y conserva la idempotencia durable', async () => {
    const repository = new PrismaReservaRepository(postgres.client);
    const created = track(await repository.crear(reservationInput()));
    await repository.cambiarEstado(created.id, 'PROGRAMADA', 'ACTIVANDO');
    const keys = new PrismaDispatchOperationStore(postgres.client);
    const key = await keys.getOrCreate(created.id);
    const cutoff = new Date(Date.now() - 120000);
    expect(await repository.recuperarActivacion(created.id, cutoff)).toBe(false);
    await postgres.client.reservation.update({
      where: { id: created.id },
      data: { updatedAt: new Date(Date.now() - 180000) },
    });
    expect(await repository.recuperarActivacion(created.id, cutoff)).toBe(true);
    expect(await keys.getOrCreate(created.id)).toBe(key);
    expect(await repository.recuperarActivacion(created.id, cutoff)).toBe(false);
    await repository.cambiarEstado(created.id, 'PROGRAMADA', 'ACTIVANDO', {
      idSolicitud: randomUUID(),
    });
    await postgres.client.reservation.update({
      where: { id: created.id },
      data: { updatedAt: new Date(Date.now() - 180000) },
    });
    expect(await repository.recuperarActivacion(created.id, cutoff)).toBe(false);
  });
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

  it('revierte la reserva si PostgreSQL rechaza la escritura del Outbox', async () => {
    const correlationId = 'm9-test-outbox-rollback';
    const input = reservationInput();
    // La restricción rechaza la segunda escritura en la base, no en un mock.
    await postgres.client.$executeRaw`
      ALTER TABLE outbox_events ADD CONSTRAINT m9_test_outbox_rollback
      CHECK (correlation_id <> 'm9-test-outbox-rollback') NOT VALID
    `;
    try {
      const repository = new PrismaReservaRepository(postgres.client);
      await expect(
        runWithRequestContext({ correlationId }, () => repository.crear(input)),
      ).rejects.toThrow(/violates check constraint.*m9_test_outbox_rollback/);
      expect(
        await postgres.client.reservation.count({ where: { clientId: input.clienteId } }),
      ).toBe(0);
      expect(await postgres.client.outboxEvent.count({ where: { correlationId } })).toBe(0);
    } finally {
      await postgres.client.$executeRaw`
        ALTER TABLE outbox_events DROP CONSTRAINT m9_test_outbox_rollback
      `;
    }
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

  it('conserva la Idempotency-Key al reclamar de nuevo una reserva tras un timeout de M5', async () => {
    const repository = new PrismaReservaRepository(postgres.client);
    const created = track(await repository.crear(reservationInput()));
    const operations = new PrismaDispatchOperationStore(postgres.client);
    await repository.cambiarEstado(created.id, 'PROGRAMADA', 'ACTIVANDO');
    const firstKey = await operations.getOrCreate(created.id);
    await repository.cambiarEstado(created.id, 'ACTIVANDO', 'PROGRAMADA');
    await repository.cambiarEstado(created.id, 'PROGRAMADA', 'ACTIVANDO');
    expect(await operations.getOrCreate(created.id)).toBe(firstKey);
  });

  it('conserva el identificador numérico de conductor recibido por REST desde M5', async () => {
    const repository = new PrismaReservaRepository(postgres.client);
    const created = track(await repository.crear(reservationInput()));
    await repository.cambiarEstado(created.id, 'PROGRAMADA', 'ACTIVANDO');
    await repository.cambiarEstado(created.id, 'ACTIVANDO', 'ACTIVADA', {
      assignedDriverId: '101',
      idSolicitud: randomUUID(),
      criterioAsignacion: 'MEJOR_VALORACION',
    });
    expect(await repository.obtenerPorId(created.id)).toMatchObject({
      estado: 'ACTIVADA',
      assignedDriverId: '101',
    });
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
