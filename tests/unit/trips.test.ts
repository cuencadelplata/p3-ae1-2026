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

function makeRepo(customer: CustomerProfile | null = makeCustomer()) {
  return { findById: vi.fn().mockResolvedValue(customer) } as any;
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

  it('cliente inexistente → null', async () => {
    const svc = new TripsService(makeRepo(null), makeM6());
    const result = await svc.getTrips('cust_xyz', 99, 'tok');
    expect(result).toBeNull();
  });

  it('cliente existente → devuelve los viajes de M6 con customerId interno', async () => {
    const trips = [
      { tripId: 'trip_1', origin: 'A', destination: 'B', fare: 1500, status: 'COMPLETADO', createdAt: '2026-09-01T00:00:00Z' }
    ];
    const svc = new TripsService(makeRepo(), makeM6(trips));
    const result = await svc.getTrips('cust_abc', 12, 'tok');
    expect(result?.customerId).toBe('cust_abc');  // customerId interno, no el userId de M1
    expect(result?.tripsCount).toBe(1);
    expect(result?.trips[0].tripId).toBe('trip_1');
    expect(result?.degraded).toBe(false);
  });

  it('el customerId en la respuesta es siempre el interno de M2, no el userId de M1', async () => {
    // M6 devuelve userId=12, pero TripsService debe normalizar a customerId interno
    const svc = new TripsService(makeRepo(makeCustomer('cust_ab12cd34')), makeM6([]));
    const result = await svc.getTrips('cust_ab12cd34', 12, 'tok');
    expect(result?.customerId).toBe('cust_ab12cd34');
  });

  it('M6 caído → respuesta degradada vacía (no 503)', async () => {
    const svc = new TripsService(makeRepo(), makeM6Caido());
    const result = await svc.getTrips('cust_abc', 12, 'tok');
    expect(result).not.toBeNull();
    expect(result?.tripsCount).toBe(0);
    expect(result?.trips).toHaveLength(0);
    expect(result?.degraded).toBe(true);
  });

  it('M6 caído no propaga ServiceUnavailableError', async () => {
    const svc = new TripsService(makeRepo(), makeM6Caido());
    await expect(svc.getTrips('cust_abc', 12, 'tok')).resolves.not.toThrow();
  });

  it('error inesperado de M6 (no ServiceUnavailableError) sí se propaga', async () => {
    const m6 = { getTrips: vi.fn().mockRejectedValue(new TypeError('bug en M6')) } as any;
    const svc = new TripsService(makeRepo(), m6);
    await expect(svc.getTrips('cust_abc', 12, 'tok')).rejects.toThrow(TypeError);
  });

  it('reenvía el token al cliente M6', async () => {
    const m6 = makeM6();
    const svc = new TripsService(makeRepo(), m6);
    await svc.getTrips('cust_abc', 12, 'mi-token-secreto');
    expect(m6.getTrips).toHaveBeenCalledWith(12, 'mi-token-secreto');
  });
});
