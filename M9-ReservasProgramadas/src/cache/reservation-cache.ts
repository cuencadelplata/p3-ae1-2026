import type { Reserva } from '../domain/reserva.js';

export interface ReservationCache {
  get(id: string): Promise<Reserva | null>;
  set(reserva: Reserva): Promise<void>;
  invalidate(id: string): Promise<void>;
}

export const NOOP_RESERVATION_CACHE: ReservationCache = {
  get: async () => null,
  set: async () => undefined,
  invalidate: async () => undefined,
};
