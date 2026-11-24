import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';

import { DependencyUnavailableError } from '../../src/errors/dependency-unavailable.error';
import { createDriversClient, DriverDataMissingError } from '../../src/integrations/m3-drivers';
import {
  createTripsClient,
  describePlace,
  toCompletedTrip,
  TripNotReadyError,
  type CompletedTrip,
} from '../../src/integrations/m6-trips';
import { parseEnvelope, type EventEnvelope } from '../../src/messaging/envelope';
import { PermanentMessageError } from '../../src/messaging/errors';
import { buildRequestFromTrip, readTripCompleted } from '../../src/messaging/trip-completed';
import type { Receipt } from '../../src/models/receipt';
import { renderReceiptPdf } from '../../src/services/pdf.service';

/** TripCompleted tal como lo publica M6 (eventos-viaje.service.ts). */
function tripCompletedEvent(tripId: string, overrides: Partial<EventEnvelope> = {}): EventEnvelope {
  return {
    messageId: randomUUID(),
    eventType: 'TripCompleted',
    version: 1,
    occurredAt: '2026-11-23T15:31:00.000Z',
    correlationId: tripId,
    producer: 'm6-viajes',
    data: { tripId, recipientId: 105, total: 5390.5, paymentId: 'pago-1' },
    ...overrides,
  };
}

const DETAIL = {
  id: 'viaje-1',
  clienteId: '105',
  conductorId: '42',
  estado: 'COMPLETADO',
  origen: 'Av. Colon 1250',
  destino: 'Aeropuerto',
  fechaCreacion: '2026-11-23T14:50:00.000Z',
  completadoAt: '2026-11-23T15:31:00.000Z',
};

const REGISTRY_ENTRY = {
  id: 'viaje-1',
  clienteId: '105',
  conductorId: '42',
  estado: 'COMPLETADO',
  origen: 'Av. Colon 1250',
  destino: 'Aeropuerto',
  finalizacion: {
    inicio: '2026-11-23T15:00:00.000Z',
    horaFin: '2026-11-23T15:31:00.000Z',
    tiempoMinutos: 31,
    tiempoEstimadoMinutos: 28,
    distanciaKm: 14.837,
    metodoPago: 'tarjeta',
    total: 5390.5,
    moneda: 'ARS',
    origen: { latitude: -31.4, longitude: -64.18 },
    destino: { latitude: -31.31, longitude: -64.21, address: 'Aeropuerto Ing. Taravella' },
    tipoVehiculo: 'auto',
    estadoPago: 'autorizado',
    paymentId: 'pago-1',
  },
  historialTransiciones: [],
};

type Route = (url: URL) => { status: number; body: unknown } | Promise<never>;

function fakeFetch(route: Route): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const result = await route(url);
    return new Response(JSON.stringify(result.body), {
      status: result.status,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
}

function m6Fetch(detail: unknown = DETAIL, entries: unknown[] = [REGISTRY_ENTRY]): typeof fetch {
  return fakeFetch((url) => {
    if (url.pathname === '/api/viajes/viaje-1') return { status: 200, body: detail };
    if (url.pathname === '/api/viajes') {
      assert.equal(url.searchParams.get('clienteId'), '105');
      assert.equal(url.searchParams.get('estado'), 'COMPLETADO');
      return { status: 200, body: { total: entries.length, limit: 100, offset: 0, viajes: entries } };
    }
    return { status: 404, body: { error: 'Viaje no encontrado' } };
  });
}

/** Perfil como lo guarda M3-Conductor: sin nombre ni apellido (son de M1). */
const M3_PROFILE = { usuarioID: '42', ciudad: 'Corrientes', tipovehiculo: 'auto', habilitado: 'activo' };

function m3Fetch(vehicles: unknown = [
  { driverId: '42', activo: true, tipoServicio: 'AUTO', patente: 'ab123cd', marca: 'Toyota', modelo: 'Etios' },
  { driverId: '42', activo: true, tipoServicio: 'MOTO', patente: 'A001BCD', marca: 'Honda', modelo: 'Wave' },
  { driverId: '42', activo: false, tipoServicio: 'AUTO', patente: 'ZZ999ZZ', marca: 'Fiat', modelo: 'Uno' },
], profile: unknown = M3_PROFILE): typeof fetch {
  return fakeFetch((url) => {
    if (url.pathname === '/api/conductores/42') return { status: 200, body: profile };
    if (url.pathname === '/api/v1/drivers/42/vehicles') return { status: 200, body: vehicles };
    return { status: 404, body: {} };
  });
}

const trips = (fetchImpl: typeof fetch) => createTripsClient({ baseUrl: 'http://m6', timeoutMs: 500, fetchImpl });
const drivers = (fetchImpl: typeof fetch) =>
  createDriversClient({ conductorBaseUrl: 'http://m3c', vehiclesBaseUrl: 'http://m3v', timeoutMs: 500, fetchImpl });

describe('trip.completed de M6: lectura del evento (Unit)', () => {
  it('acepta el TripCompleted que publica M6', () => {
    const envelope = parseEnvelope(Buffer.from(JSON.stringify(tripCompletedEvent('viaje-1'))));
    assert.equal(envelope.ok, true);
    if (!envelope.ok) return;
    const event = readTripCompleted(envelope.value);
    assert.deepEqual(event, { ok: true, value: { tripId: 'viaje-1', recipientId: 105 } });
  });

  it('rechaza otro tipo de evento, otra version, correlationId distinto o recipientId no numerico', () => {
    assert.equal(readTripCompleted(tripCompletedEvent('viaje-1', { eventType: 'TripStarted' })).ok, false);
    assert.equal(readTripCompleted(tripCompletedEvent('viaje-1', { version: 2 })).ok, false);
    assert.equal(readTripCompleted(tripCompletedEvent('viaje-1', { correlationId: 'otro' })).ok, false);
    const sinUsuario = tripCompletedEvent('viaje-1', { data: { tripId: 'viaje-1', recipientId: 'abc' } });
    assert.equal(readTripCompleted(sinUsuario).ok, false);
  });
});

describe('cliente de M6 (Unit)', () => {
  it('arma el viaje con el detalle y la finalizacion del registro', async () => {
    const trip = await trips(m6Fetch()).getCompletedTrip('viaje-1');
    assert.deepEqual(trip, {
      tripId: 'viaje-1',
      customerId: '105',
      driverId: '42',
      origin: 'Av. Colon 1250',
      destination: 'Aeropuerto Ing. Taravella',
      startedAt: '2026-11-23T15:00:00.000Z',
      finishedAt: '2026-11-23T15:31:00.000Z',
      distanceKm: 14.837,
      durationMin: 31,
      vehicleType: 'AUTO',
      paymentMethod: 'tarjeta',
      total: 5390.5,
      currency: 'ARS',
    });
  });

  it('el viaje que no esta COMPLETADO o no figura en el registro se reintenta', async () => {
    await assert.rejects(trips(m6Fetch({ ...DETAIL, estado: 'EN_CURSO' })).getCompletedTrip('viaje-1'), TripNotReadyError);
    await assert.rejects(trips(m6Fetch(DETAIL, [])).getCompletedTrip('viaje-1'), TripNotReadyError);
    await assert.rejects(trips(m6Fetch()).getCompletedTrip('viaje-x'), TripNotReadyError);
  });

  it('M6 caido o con error 5xx es dependencia no disponible', async () => {
    const caido = fakeFetch(() => Promise.reject(new TypeError('fetch failed')));
    await assert.rejects(trips(caido).getCompletedTrip('viaje-1'), DependencyUnavailableError);
    const error = fakeFetch(() => ({ status: 503, body: { error: 'Base de datos no disponible' } }));
    await assert.rejects(trips(error).getCompletedTrip('viaje-1'), DependencyUnavailableError);
  });

  it('describe el lugar con la direccion, el texto pedido o las coordenadas', () => {
    assert.equal(describePlace('Calle A', { latitude: 1, longitude: 2, address: 'Calle B 10' }), 'Calle B 10');
    assert.equal(describePlace('Calle A', { latitude: 1, longitude: 2 }), 'Calle A');
    assert.equal(describePlace('{"lat":1,"lng":2,"address":"Calle C"}', undefined), 'Calle C');
    assert.equal(describePlace(undefined, { latitude: -31.4, longitude: -64.18 }), '-31.40000, -64.18000');
  });

  it('informa los datos de cierre que faltan', () => {
    const result = toCompletedTrip('viaje-1', DETAIL, { ...REGISTRY_ENTRY, finalizacion: { horaFin: 'x' } });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(result.errors.includes('finalizacion.distanciaKm'));
      assert.ok(result.errors.includes('finalizacion.tipoVehiculo'));
    }
  });
});

describe('cliente de M3 (Unit)', () => {
  it('devuelve el vehiculo activo del tipo del viaje; sin nombre si M3 no lo guarda', async () => {
    const driver = await drivers(m3Fetch()).getDriver(42, 'AUTO');
    assert.deepEqual(driver, {
      id: '42',
      vehicle: { type: 'AUTO', plate: 'AB123CD', model: 'Toyota Etios' },
    });
  });

  it('usa nombre y apellido si M3 los informa', async () => {
    const conNombre = m3Fetch(undefined, { ...M3_PROFILE, nombre: 'Martin', apellido: 'Rodriguez' });
    const driver = await drivers(conNombre).getDriver(42, 'MOTO');
    assert.equal(driver.fullName, 'Martin Rodriguez');
    assert.equal(driver.vehicle.plate, 'A001BCD');
  });

  it('sin vehiculo activo del tipo o sin alta en M3 se reintenta', async () => {
    await assert.rejects(drivers(m3Fetch([])).getDriver(42, 'AUTO'), DriverDataMissingError);
    await assert.rejects(drivers(m3Fetch()).getDriver(7, 'AUTO'), DriverDataMissingError);
  });

  it('M3 caido es dependencia no disponible', async () => {
    const caido = fakeFetch(() => Promise.reject(new TypeError('fetch failed')));
    await assert.rejects(drivers(caido).getDriver(42, 'AUTO'), DependencyUnavailableError);
  });
});

describe('pedido de emision desde TripCompleted (Unit)', () => {
  const deps = { trips: trips(m6Fetch()), drivers: drivers(m3Fetch()) };

  it('combina M6 (viaje), M3 (conductor) y el userId de M1 del cliente', async () => {
    const request = await buildRequestFromTrip({ tripId: 'viaje-1', recipientId: 105 }, deps);
    assert.equal(request.customerUserId, 105);
    assert.equal(request.driverUserId, 42);
    assert.deepEqual(request.customer, { id: '105' });
    assert.equal(request.driver.vehicle.plate, 'AB123CD');
    assert.equal(request.trip.distanceKm, 14.84);
    assert.equal(request.trip.destination, 'Aeropuerto Ing. Taravella');
    assert.equal(request.fare.total, 5390.5);
    assert.equal(request.fare.currency, 'ARS');
    assert.equal(request.payment.method, 'TARJETA');
  });

  it('un conductor sin userId numerico o un medio de pago desconocido va a la DLQ', async () => {
    const noNumerico: typeof deps = {
      trips: { getCompletedTrip: async () => ({ ...(await deps.trips.getCompletedTrip('viaje-1')), driverId: 'cnd-x' }) },
      drivers: deps.drivers,
    };
    await assert.rejects(buildRequestFromTrip({ tripId: 'viaje-1', recipientId: 105 }, noNumerico), PermanentMessageError);

    const otroMedio: typeof deps = {
      trips: {
        getCompletedTrip: async (): Promise<CompletedTrip> => ({
          ...(await deps.trips.getCompletedTrip('viaje-1')),
          paymentMethod: 'cripto',
        }),
      },
      drivers: deps.drivers,
    };
    await assert.rejects(buildRequestFromTrip({ tripId: 'viaje-1', recipientId: 105 }, otroMedio), PermanentMessageError);
  });

  it('el PDF se genera sin nombre de cliente, con el numero de usuario', async () => {
    const request = await buildRequestFromTrip({ tripId: 'viaje-1', recipientId: 105 }, deps);
    const receipt: Receipt = {
      ...request,
      receiptId: randomUUID(),
      receiptNumber: 'M8-20261123-000001',
      issuedAt: '2026-11-23T15:32:00.000Z',
      payment: { method: 'TARJETA', status: 'APROBADO' },
      deliveries: [],
    };
    const pdf = await renderReceiptPdf(receipt);
    assert.equal(pdf.subarray(0, 4).toString(), '%PDF');
  });
});
