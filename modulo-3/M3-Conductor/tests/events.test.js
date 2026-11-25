const { test, expect } = require('@playwright/test');
const path = require('path');
const {
  createMockFn,
  mockModule,
  clearModule
} = require('./helpers/testUtils');

const SRC = path.join(__dirname, '..', 'src');
const eventPublisherPath = path.join(SRC, 'events', 'eventPublisher.js');
const gatewayPath = path.join(SRC, 'infraestructure', 'messagingGateway.js');
const EXCHANGE = 'm3.conductores.events';

const {
  EVENTOS,
  driverAvailabilityUpdated,
  driverStatusChanged
} = require('../src/events/driverEvents');

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
  let eventPublisher;
  let gateway;
  let mockChannel;
  let connectRabbitMQ;
  let probeRabbitMQ;
  let kafkaPublish;
  let kafkaDrain;
  let startKafka;
  let stopKafka;

  function cargarPublicador(kafkaEnabled) {
    mockChannel = {
      assertExchange: createMockFn().mockResolvedValue(),
      publish: createMockFn().mockReturnValue(true),
      waitForConfirms: createMockFn().mockResolvedValue()
    };
    connectRabbitMQ = createMockFn().mockResolvedValue(mockChannel);
    probeRabbitMQ = createMockFn().mockResolvedValue(true);
    kafkaPublish = createMockFn();
    kafkaDrain = createMockFn();
    startKafka = createMockFn().mockResolvedValue(false);
    stopKafka = createMockFn().mockResolvedValue();

    const dependencies = [
      ['config/rabbitmqClient.js', { EXCHANGE }],
      ['infraestructure/rabbimq.client.js', { connectRabbitMQ, probeRabbitMQ }],
      ['infraestructure/kafkaLifecycle.js', { startKafka, stopKafka }],
      ['infraestructure/kafkaFallback.js', { publish: kafkaPublish, drain: kafkaDrain }]
    ];
    const paths = [
      ...dependencies.map(([relative]) => require.resolve(path.join(SRC, relative))),
      require.resolve(gatewayPath),
      require.resolve(eventPublisherPath)
    ];
    const previous = paths.map((file) => [file, require.cache[file]]);
    const previousKafkaEnabled = process.env.KAFKA_FALLBACK_ENABLED;

    try {
      process.env.KAFKA_FALLBACK_ENABLED = String(kafkaEnabled);
      for (const [relative, stub] of dependencies) mockModule(path.join(SRC, relative), stub);
      clearModule(gatewayPath);
      clearModule(eventPublisherPath);
      eventPublisher = require(eventPublisherPath);
      gateway = require(gatewayPath);
    } finally {
      if (previousKafkaEnabled === undefined) delete process.env.KAFKA_FALLBACK_ENABLED;
      else process.env.KAFKA_FALLBACK_ENABLED = previousKafkaEnabled;
      for (const [file, cached] of previous) {
        if (cached) require.cache[file] = cached;
        else delete require.cache[file];
      }
    }
  }

  test.beforeEach(() => {
    cargarPublicador(true);
  });

  test('publicar envía el mensaje a RabbitMQ con las propiedades AMQP requeridas y espera confirmación', async () => {
    const mockEvento = driverAvailabilityUpdated({
      usuarioID: 'cond_001',
      disponible: true,
      disponibleAnterior: false
    });

    const resultado = await eventPublisher.publicar('driver.availability.updated', mockEvento);

    expect(resultado).toBe(true);
    expect(connectRabbitMQ.calls.length).toBe(1);
    expect(mockChannel.assertExchange.calls).toEqual([[EXCHANGE, 'topic', { durable: true }]]);
    expect(mockChannel.publish.calls.length).toBe(1);

    const [exchange, routingKey, buffer, props] = mockChannel.publish.calls[0];
    expect(exchange).toBe(EXCHANGE);
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
    expect(startKafka.calls).toHaveLength(0);
    expect(kafkaPublish.calls).toHaveLength(0);
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

  test('si RabbitMQ y el respaldo Kafka fallan, nunca lanza excepción y devuelve false', async () => {
    connectRabbitMQ.mockRejectedValue(new Error('RabbitMQ no disponible'));
    kafkaPublish.mockRejectedValue(new Error('Kafka no disponible'));

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
      expect(startKafka.calls).toHaveLength(1);
      expect(kafkaPublish.calls).toHaveLength(1);
      expect(kafkaPublish.calls[0][0].routingKey).toBe('driver.status.changed');
      expect(errorCalls.flat()).toContain('[Circuit] No se pudo publicar DriverStatusChanged (driver.status.changed): Kafka no disponible');
    } finally {
      console.error = originalError;
    }
  });

  test('recupera RabbitMQ tras una caída cuando el despliegue no usa Kafka', async () => {
    cargarPublicador(false);
    const onRabbitReady = createMockFn().mockResolvedValue();
    const setIntervalOriginal = global.setInterval;
    let tick;
    try {
      global.setInterval = (callback) => {
        tick = callback;
        return { unref() {} };
      };
      gateway.start({ onRabbitReady });
    } finally {
      global.setInterval = setIntervalOriginal;
    }
    await new Promise((resolve) => setImmediate(resolve));

    async function sondear(disponible) {
      probeRabbitMQ.mockResolvedValue(disponible);
      tick();
      await new Promise((resolve) => setImmediate(resolve));
    }

    await sondear(false);
    await sondear(false);
    expect(gateway.status()).toEqual({ circuit: 'OPEN', rabbitmq: 'down', fallback: 'off' });
    expect(await eventPublisher.publicarDriverStatusChanged({ usuarioID: '8', habilitado: 'activo' })).toBe(false);

    await sondear(true);
    expect(gateway.status().circuit).toBe('HALF_OPEN');
    await sondear(true);
    expect(gateway.status()).toEqual({ circuit: 'CLOSED', rabbitmq: 'up', fallback: 'off' });
    expect(onRabbitReady.calls).toHaveLength(2);
    expect(await eventPublisher.publicarDriverStatusChanged({ usuarioID: '8', habilitado: 'activo' })).toBe(true);
    expect(startKafka.calls).toHaveLength(0);
    expect(stopKafka.calls).toHaveLength(0);
    expect(kafkaDrain.calls).toHaveLength(0);
    expect(kafkaPublish.calls).toHaveLength(0);
  });
});
