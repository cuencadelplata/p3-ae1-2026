import { customerRepository, CustomerRepository } from '../repositories/customer.repository.js';
import { m6Client, M6Client } from '../clients/m6.client.js';
import { ServiceUnavailableError } from '../errors/service-unavailable.error.js';
import type { CustomerTripsResponse } from '../types/customer.js';

/**
 * Respuesta degradada que se devuelve cuando M6 no está disponible.
 * Indica claramente al cliente que los datos pueden no estar actualizados.
 */
function fallbackResponse(customerId: string): CustomerTripsResponse {
  return {
    customerId,
    tripsCount: 0,
    trips: [],
    degraded: true
  };
}

/**
 * Servicio de historial de viajes (RF-2.3).
 * Separado del CustomerService para no pisar los cambios de Erwin.
 *
 * Reglas:
 *  1. Si el cliente no existe en M2 → null (404).
 *  2. Se consulta M6 por userId (no customerId) reenviando el token.
 *  3. Si M6 está caído → respuesta degradada vacía (no 503), para no bloquear al usuario.
 *     El plan dice "decidir si mantiene el dataset de respaldo": se elige vacío
 *     porque los datos hardcodeados del service viejo podían confundir.
 *  4. El customerId que se devuelve es el interno de M2 (cust_xxx), no el userId de M1.
 */
export class TripsService {
  constructor(
    private readonly repository: CustomerRepository = customerRepository,
    private readonly m6: M6Client = m6Client
  ) {}

  /**
   * RF-2.3: Historial de Viajes.
   *
   * @param customerId  ID interno del cliente (cust_xxx)
   * @param userId      userId de M1 (con el que M6 indexa los viajes)
   * @param token       JWT del usuario autenticado (se reenvía a M6)
   * @returns null si el cliente no existe; CustomerTripsResponse en cualquier otro caso
   */
  async getTrips(
    customerId: string,
    userId: number,
    token: string
  ): Promise<CustomerTripsResponse | null> {
    const customer = await this.repository.findById(customerId);
    if (!customer) return null;

    try {
      const response = await this.m6.getTrips(userId, token);
      // Normalizar el customerId al interno de M2
      return { ...response, customerId, degraded: false };
    } catch (err) {
      if (err instanceof ServiceUnavailableError) {
        console.warn(
          `[TripsService] M6 no disponible para userId=${userId}. ` +
          `Devolviendo respuesta degradada vacía.`
        );
        return fallbackResponse(customerId);
      }
      throw err;
    }
  }
}

export const tripsService = new TripsService();
