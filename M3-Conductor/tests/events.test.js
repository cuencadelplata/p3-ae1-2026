const { test, expect } = require('@playwright/test');
const path = require('path');
const {
  createMockFn,
  mockModule,
  clearModule,
  clearAllMocks
} = require('./helpers/testUtils');

const SRC = path.join(__dirname, '..', 'src');
const rabbitmqPath = path.join(SRC, 'config', 'rabbitmqClient.js');
const eventPublisherPath = path.join(SRC, 'events', 'eventPublisher.js');

const rabbitmq = {
  getChannel: createMockFn(),
  EXCHANGE: 'm3.conductores.events'
};
mockModule(rabbitmqPath, rabbitmq);

clearModule(eventPublisherPath);
const {
  EVENTOS,
  driverAvailabilityUpdated,
  driverStatusChanged
} = require('../src/events/driverEvents');
const eventPublisher = require('../src/events/eventPublisher');

test.beforeEach(() => {
  clearAllMocks(rabbitmq.getChannel);
});

test.describe('driverEvents (RNF-07 - Definición de contratos y envelopes)', () => {
  const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  test('EVENTOS define los tipos y routing keys esperados', () => {
    expect(EVENTOS.DRIVER_AVAILABILITY_UPDATED).toEqual({
      tipo: 'DriverAvailabilityUpdated',
      routingKey: 'driver.availability.updated',
      version: 1
    });

    expect(EVENTOS.DRIVER_STATUS_CHANGED).toEqual({
      tipo: 'DriverStatusChanged',
      routingKey: 'driver.status.changed',
      version: 1
    });
  });

  test('driverAvailabilityUpdated genera envelope estándar y castea a booleano', () => {
    const evento = driverAvailabilityUpdated({
      usuarioID: 'cond_001',
      disponible: 1,
      disponibleAnterior: 0
    });

    expect(evento.eventId).toMatch(UUID_REGEX);
    expect(evento.eventType).toBe('DriverAvailabilityUpdated');
    expect(evento.eventVersion).toBe(1);
    expect(evento.source).toBe('M3-Conductor');
    expect(evento.occurredAt).toBeDefined();
    expect(Number.isNaN(Date.parse(evento.occurredAt))).toBe(false);
    expect(evento.data).toEqual({
      usuarioID: 'cond_001',
      disponible: true,
      disponibleAnterior: false
    });
  });

  test('driverStatusChanged genera envelope estándar con campos obligatorios y motivo opcional', () => {
    const eventoConMotivo = driverStatusChanged({
      usuarioID: 'cond_002',
      habilitado: 'activo',
      habilitadoAnterior: 'pendiente',
      motivo: 'Licencia aprobada'
    });

    expect(eventoConMotivo.eventId).toMatch(UUID_REGEX);
    expect(eventoConMotivo.eventType).toBe('DriverStatusChanged');
    expect(eventoConMotivo.eventVersion).toBe(1);
    expect(eventoConMotivo.source).toBe('M3-Conductor');
    expect(eventoConMotivo.data).toEqual({
      usuarioID: 'cond_002',
      habilitado: 'activo',
      habilitadoAnterior: 'pendiente',
      motivo: 'Licencia aprobada'
    });

    const eventoSinMotivo = driverStatusChanged({
      usuarioID: 'cond_003',
      habilitado: 'suspendido'
    });

    expect(eventoSinMotivo.data.habilitadoAnterior).toBeNull();
    expect(eventoSinMotivo.data.motivo).toBeNull();
  });
});

test.describe('eventPublisher (RNF-07 - Publicación con ConfirmChannel)', () => {
  let mockChannel;

  test.beforeEach(() => {
    mockChannel = {
      publish: createMockFn(),
      waitForConfirms: createMockFn().mockResolvedValue()
    };
    rabbitmq.getChannel.mockResolvedValue(mockChannel);
  });

  test('publicar envía el mensaje a RabbitMQ con las propiedades AMQP requeridas y espera confirmación', async () => {
    const mockEvento = driverAvailabilityUpdated({
      usuarioID: 'cond_001',
      disponible: true,
      disponibleAnterior: false
    });

    const resultado = await eventPublisher.publicar('driver.availability.updated', mockEvento);

    expect(resultado).toBe(true);
    expect(rabbitmq.getChannel.calls.length).toBe(1);
    expect(mockChannel.publish.calls.length).toBe(1);

    const [exchange, routingKey, buffer, props] = mockChannel.publish.calls[0];
    expect(exchange).toBe('m3.conductores.events');
    expect(routingKey).toBe('driver.availability.updated');
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(JSON.parse(buffer.toString())).toEqual(mockEvento);
    expect(props).toMatchObject({
      persistent: true,
      contentType: 'application/json',
      messageId: mockEvento.eventId,
      type: 'DriverAvailabilityUpdated',
      appId: 'M3-Conductor'
    });
    expect(typeof props.timestamp).toBe('number');
    expect(mockChannel.waitForConfirms.calls.length).toBe(1);
  });

  test('publicarDriverAvailabilityUpdated publica con la routing key driver.availability.updated', async () => {
    const resultado = await eventPublisher.publicarDriverAvailabilityUpdated({
      usuarioID: 'cond_001',
      disponible: true,
      disponibleAnterior: false
    });

    expect(resultado).toBe(true);
    const [exchange, routingKey, buffer, props] = mockChannel.publish.calls[0];
    expect(exchange).toBe('m3.conductores.events');
    expect(routingKey).toBe('driver.availability.updated');
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(props.type).toBe('DriverAvailabilityUpdated');
  });

  test('publicarDriverStatusChanged publica con la routing key driver.status.changed', async () => {
    const resultado = await eventPublisher.publicarDriverStatusChanged({
      usuarioID: 'cond_002',
      habilitado: 'activo',
      habilitadoAnterior: 'pendiente',
      motivo: 'Verificación ok'
    });

    expect(resultado).toBe(true);
    const [exchange, routingKey, , props] = mockChannel.publish.calls[0];
    expect(exchange).toBe('m3.conductores.events');
    expect(routingKey).toBe('driver.status.changed');
    expect(props.type).toBe('DriverStatusChanged');
  });

  test('si RabbitMQ no está disponible o falla, nunca lanza excepción y devuelve false', async () => {
    rabbitmq.getChannel.mockRejectedValue(new Error('Broker unreachable'));

    const originalError = console.error;
    const errorCalls = [];
    console.error = (...args) => {
      errorCalls.push(args);
    };

    try {
      const mockEvento = driverStatusChanged({
        usuarioID: 'cond_001',
        habilitado: 'suspendido'
      });

      const resultado = await eventPublisher.publicar('driver.status.changed', mockEvento);

      expect(resultado).toBe(false);
      expect(errorCalls.length).toBeGreaterThan(0);
      expect(String(errorCalls[0][0])).toContain('[RabbitMQ] No se pudo publicar DriverStatusChanged');
    } finally {
      console.error = originalError;
    }
  });
});
