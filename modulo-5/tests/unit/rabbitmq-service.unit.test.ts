import { describe, it, expect, beforeEach, afterAll } from '@jest/globals';
import { RabbitMQService } from '../../src/services/rabbitmq.service';
import { RideRequest } from '../../src/types/ride-request.types';

describe('RabbitMQService (RNF-07, Criterio 5 - Integración M5 -> M8)', () => {
  let rabbitmqService: RabbitMQService;

  const mockRequest: RideRequest = {
    id: 'req_test_999',
    clientId: 'client_42',
    origin: { latitude: -27.46, longitude: -58.98, address: 'Av. Costanera 1234' },
    destination: { latitude: -27.47, longitude: -58.99, address: 'San Juan 500' },
    vehicleType: 'AUTO',
    status: 'SEARCHING',
    estimatedFare: {
      amount: 2225,
      currency: 'ARS',
      estimatedDistanceKm: 3.5,
      estimatedDurationMin: 12,
      fareToken: 'est_1234567890'
    },
    assignedDriverId: null,
    idempotencyKey: 'idem_rabbit_1',
    createdAt: '2026-10-05T11:00:00.000Z',
    updatedAt: '2026-10-05T11:00:00.000Z',
    expiresAt: '2026-10-05T11:03:00.000Z'
  };

  beforeEach(() => {
    rabbitmqService = new RabbitMQService();
    rabbitmqService.clearBuffer();
  });

  afterAll(async () => {
    await rabbitmqService.disconnect();
  });

  it('debe tener configurado el exchange y tipo correctos según el contrato con M8', () => {
    expect(rabbitmqService.exchangeName).toBe('mobility.events');
    expect(rabbitmqService.exchangeType).toBe('topic');
  });

  it('debe publicar el evento con el sobre (envelope) canónico acordado con Módulo 8', async () => {
    const published = await rabbitmqService.publishRideRequestCreated(mockRequest);
    expect(published).toBe(true);

    const events = rabbitmqService.getPublishedEvents();
    expect(events.length).toBe(1);

    const event = events[0];
    // Sobre (Envelope)
    expect(event.messageId).toBeDefined();
    expect(event.eventType).toBe('ride.requested');
    expect(event.version).toBe(1);
    expect(event.occurredAt).toBeDefined();
    expect(event.correlationId).toBe('req_test_999');
    expect(event.producer).toBe('m5');

    // Data del evento
    expect(event.data.rideRequestId).toBe('req_test_999');
    expect(event.data.clientUserId).toBe(42);
    expect(typeof event.data.clientUserId).toBe('number');
    expect(event.data.origin.address).toBe('Av. Costanera 1234');
    expect(event.data.destination.address).toBe('San Juan 500');
    expect(event.data.vehicleType).toBe('AUTO');
    expect(event.data.estimatedFare.amount).toBe(2225);
    expect(event.data.estimatedFare.currency).toBe('ARS');
    expect(event.data.createdAt).toBe('2026-10-05T11:00:00.000Z');
  });

  it('debe parsear clientUserId numérico canónico de M1 correctamente', async () => {
    await rabbitmqService.publishRideRequestCreated({
      ...mockRequest,
      clientId: 'usr_789'
    });

    const events = rabbitmqService.getPublishedEvents();
    expect(events[0].data.clientUserId).toBe(789);
  });
});
