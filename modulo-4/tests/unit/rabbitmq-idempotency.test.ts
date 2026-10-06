import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TripEventHandler } from '../../src/application/event-handlers/trip-event.handler.js';
import type { DriverAvailabilityChangedEvent } from '../../src/domain/entities/location.entity.js';
import { RabbitMQTripEventConsumer } from '../../src/infrastructure/rabbitmq/rabbitmq-trip-event.consumer.js';
import type { RabbitMQConnection } from '../../src/infrastructure/rabbitmq/rabbitmq.connection.js';
import { MemoryLocationRepository } from '../../src/infrastructure/redis/memory-location.repository.js';
import { RedisEventStore } from '../../src/infrastructure/redis/redis-event-store.js';
import type { EventPublisher } from '../../src/ports/event-publisher.port.js';

describe('RabbitMQ, Adaptación M6 e Idempotencia (RNF-07 / RNF-08 / Requerimiento 7)', () => {
  let repository: MemoryLocationRepository;
  let eventStore: RedisEventStore;
  let mockPublisher: EventPublisher;
  let tripEventHandler: TripEventHandler;
  let consumer: RabbitMQTripEventConsumer;
  let publishedEvents: DriverAvailabilityChangedEvent[];

  beforeEach(async () => {
    repository = new MemoryLocationRepository();
    eventStore = new RedisEventStore();
    publishedEvents = [];

    mockPublisher = {
      publishDriverAvailabilityChanged: async (event) => {
        publishedEvents.push(event);
      }
    };

    tripEventHandler = new TripEventHandler(repository, mockPublisher);

    const mockConnectionManager = {
      getChannel: async () => null,
      connect: async () => {},
      isConnected: async () => true,
      close: async () => {}
    } as unknown as RabbitMQConnection;

    consumer = new RabbitMQTripEventConsumer(
      mockConnectionManager,
      tripEventHandler,
      eventStore
    );

    // Guardar ubicación inicial activa para conductor 100
    await repository.saveIfNewer({
      driverId: 100,
      latitude: -27.4692,
      longitude: -58.8306,
      vehicleType: 'AUTO',
      available: true,
      updatedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString()
    }, 60);
  });

  it('debe procesar un evento de viaje TripStarted (o viaje.iniciado) y marcar el conductor como NO disponible', async () => {
    const mockChannel = {
      ack: vi.fn(),
      nack: vi.fn()
    } as any;

    const mockMsg = {
      content: Buffer.from(
        JSON.stringify({
          eventId: 'evt-001',
          tripId: 'trip-99',
          driverId: 100, // ID entero
          eventType: 'viaje.iniciado', // Adaptación propuesta M6
          timestamp: new Date().toISOString()
        })
      ),
      properties: { headers: {} },
      fields: { routingKey: 'viaje.iniciado' }
    } as any;

    await consumer.processMessage(mockChannel, mockMsg);

    const updated = await repository.get(100);
    expect(updated?.available).toBe(false);

    expect(mockChannel.ack).toHaveBeenCalledWith(mockMsg);
    expect(publishedEvents).toHaveLength(1);
    expect(publishedEvents[0].driverId).toBe(100);
    expect(publishedEvents[0].available).toBe(false);
  });

  it('debe rechazar y enviar a DLQ un mensaje con driverId no numérico o inválido', async () => {
    const mockChannel = {
      ack: vi.fn(),
      nack: vi.fn()
    } as any;

    const mockMsg = {
      content: Buffer.from(
        JSON.stringify({
          eventId: 'evt-invalid',
          tripId: 'trip-99',
          driverId: 'invalid-string-id',
          eventType: 'TripStarted',
          timestamp: new Date().toISOString()
        })
      ),
      properties: { headers: {} },
      fields: { routingKey: 'TripStarted' }
    } as any;

    await consumer.processMessage(mockChannel, mockMsg);

    expect(mockChannel.nack).toHaveBeenCalledWith(mockMsg, false, false); // Enviado a DLQ (no requeue)
    expect(mockChannel.ack).not.toHaveBeenCalled();
  });

  it('debe ignorar eventos duplicados con el mismo eventId debido a la verificación de idempotencia', async () => {
    const mockChannel = {
      ack: vi.fn(),
      nack: vi.fn()
    } as any;

    const mockMsg = {
      content: Buffer.from(
        JSON.stringify({
          eventId: 'evt-dup-123',
          tripId: 'trip-99',
          driverId: 100,
          eventType: 'TripStarted',
          timestamp: new Date().toISOString()
        })
      ),
      properties: { headers: {} },
      fields: { routingKey: 'TripStarted' }
    } as any;

    // Primer procesamiento
    await consumer.processMessage(mockChannel, mockMsg);
    expect(mockChannel.ack).toHaveBeenCalledTimes(1);

    // Segundo procesamiento (duplicado)
    await consumer.processMessage(mockChannel, mockMsg);
    expect(mockChannel.ack).toHaveBeenCalledTimes(2);

    expect(publishedEvents).toHaveLength(1);
  });
});
