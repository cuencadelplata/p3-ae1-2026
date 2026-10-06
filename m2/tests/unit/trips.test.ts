import { describe, it, expect, vi, afterEach } from 'vitest';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { TripsService } from '../../src/services/trips.service.js';
import { ServiceUnavailableError } from '../../src/errors/service-unavailable.error.js';
import { UserIdSchema, type CustomerProfile } from '../../src/types/customer.js';

// ─── helpers ──────────────────────────────────────────────────────────────────

function makeCustomer(customerId = 'cust_abc'): CustomerProfile {
  return {
    customerId,
    userId: UserIdSchema.parse(12),
    preferences: { preferredVehicleType: 'auto', notificationChannel: 'email' },
    status: 'ACTIVO',
    createdAt: '2026-09-01T00:00:00Z'
  };
}

function makeM6(trips: any[] = []) {
  return {
    getTrips: vi.fn().mockResolvedValue({
      customerId: '12',
      tripsCount: trips.length,
      trips
    })
  } as any;
}

function makeM6Caido() {
  return {
    getTrips: vi.fn().mockRejectedValue(new ServiceUnavailableError('M6 caído'))
  } as any;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('TripsService.getTrips', () => {
  afterEach(() => vi.restoreAllMocks());

  it('cliente existente → devuelve los viajes de M6 con customerId interno', async () => {
    const trips = [
      { tripId: 'trip_1', origin: 'A', destination: 'B', fare: 1500, status: 'COMPLETADO', createdAt: '2026-09-01T00:00:00Z' }
    ];
    const svc = new TripsService(makeM6(trips));
    const result = await svc.getTrips(makeCustomer());
    expect(result.customerId).toBe('cust_abc');  // customerId interno, no el userId de M1
    expect(result.tripsCount).toBe(1);
    expect(result.trips[0].tripId).toBe('trip_1');
    expect(result.degraded).toBe(false);
  });

  it('el customerId en la respuesta es siempre el interno de M2, no el userId de M1', async () => {
    // M6 devuelve userId=12, pero TripsService debe normalizar a customerId interno
    const svc = new TripsService(makeM6([]));
    const result = await svc.getTrips(makeCustomer('cust_ab12cd34'));
    expect(result.customerId).toBe('cust_ab12cd34');
  });

  it('M6 caído → respuesta degradada vacía (no 503)', async () => {
    const svc = new TripsService(makeM6Caido());
    const result = await svc.getTrips(makeCustomer());
    expect(result.tripsCount).toBe(0);
    expect(result.trips).toHaveLength(0);
    expect(result.degraded).toBe(true);
  });

  it('M6 caído no propaga ServiceUnavailableError', async () => {
    const svc = new TripsService(makeM6Caido());
    await expect(svc.getTrips(makeCustomer())).resolves.not.toThrow();
  });

  it('error inesperado de M6 (no ServiceUnavailableError) sí se propaga', async () => {
    const m6 = { getTrips: vi.fn().mockRejectedValue(new TypeError('bug en M6')) } as any;
    const svc = new TripsService(m6);
    await expect(svc.getTrips(makeCustomer())).rejects.toThrow(TypeError);
  });

  it('consulta M6 con el userId del perfil, no con el de quien pide', async () => {
    const m6 = makeM6();
    const svc = new TripsService(m6);
    await svc.getTrips(makeCustomer());
    expect(m6.getTrips).toHaveBeenCalledWith(12);
  });

  it('no reenvía el token del usuario a M6 (su endpoint no tiene autenticación)', async () => {
    const m6 = makeM6();
    const svc = new TripsService(m6);
    await svc.getTrips(makeCustomer());
    expect(m6.getTrips.mock.calls[0]).toEqual([12]);
  });
});
