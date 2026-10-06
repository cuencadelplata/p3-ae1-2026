const {
  EVENTOS,
  driverAvailabilityUpdated,
  driverStatusChanged
} = require('../src/events/driverEvents');
const rabbitmq = require('../src/config/rabbitmqClient');
const eventPublisher = require('../src/events/eventPublisher');

jest.mock('../src/config/rabbitmqClient', () => ({
  getChannel: jest.fn(),
  EXCHANGE: 'm3.conductores.events'
}));

beforeEach(() => {
  jest.clearAllMocks();
});

describe('driverEvents (RNF-07 - Definición de contratos y envelopes)', () => {
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
    expect(Date.parse(evento.occurredAt)).not.toBeNaN();
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

describe('eventPublisher (RNF-07 - Publicación con ConfirmChannel)', () => {
  let mockChannel;

  beforeEach(() => {
    mockChannel = {
      publish: jest.fn(),
      waitForConfirms: jest.fn().mockResolvedValue()
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
    expect(rabbitmq.getChannel).toHaveBeenCalledTimes(1);
    expect(mockChannel.publish).toHaveBeenCalledWith(
      'm3.conductores.events',
      'driver.availability.updated',
      Buffer.from(JSON.stringify(mockEvento)),
      expect.objectContaining({
        persistent: true,
        contentType: 'application/json',
        messageId: mockEvento.eventId,
        type: 'DriverAvailabilityUpdated',
        appId: 'M3-Conductor',
        timestamp: expect.any(Number)
      })
    );
    expect(mockChannel.waitForConfirms).toHaveBeenCalledTimes(1);
  });

  test('publicarDriverAvailabilityUpdated publica con la routing key driver.availability.updated', async () => {
    const resultado = await eventPublisher.publicarDriverAvailabilityUpdated({
      usuarioID: 'cond_001',
      disponible: true,
      disponibleAnterior: false
    });

    expect(resultado).toBe(true);
    expect(mockChannel.publish).toHaveBeenCalledWith(
      'm3.conductores.events',
      'driver.availability.updated',
      expect.any(Buffer),
      expect.objectContaining({ type: 'DriverAvailabilityUpdated' })
    );
  });

  test('publicarDriverStatusChanged publica con la routing key driver.status.changed', async () => {
    const resultado = await eventPublisher.publicarDriverStatusChanged({
      usuarioID: 'cond_002',
      habilitado: 'activo',
      habilitadoAnterior: 'pendiente',
      motivo: 'Verificación ok'
    });

    expect(resultado).toBe(true);
    expect(mockChannel.publish).toHaveBeenCalledWith(
      'm3.conductores.events',
      'driver.status.changed',
      expect.any(Buffer),
      expect.objectContaining({ type: 'DriverStatusChanged' })
    );
  });

  test('si RabbitMQ no está disponible o falla, nunca lanza excepción y devuelve false (resiliencia)', async () => {
    rabbitmq.getChannel.mockRejectedValue(new Error('Broker unreachable'));

    const spyError = jest.spyOn(console, 'error').mockImplementation(() => {});

    const mockEvento = driverStatusChanged({
      usuarioID: 'cond_001',
      habilitado: 'suspendido'
    });

    const resultado = await eventPublisher.publicar('driver.status.changed', mockEvento);

    expect(resultado).toBe(false);
    expect(spyError).toHaveBeenCalledWith(
      expect.stringContaining('[RabbitMQ] No se pudo publicar DriverStatusChanged')
    );

    spyError.mockRestore();
  });
});
