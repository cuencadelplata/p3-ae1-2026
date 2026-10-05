import { m6Client, M6Client } from '../clients/m6.client.js';
import { ServiceUnavailableError } from '../errors/service-unavailable.error.js';
import type { CustomerProfile, CustomerTripsResponse } from '../types/customer.js';

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
 *  1. Recibe el perfil ya verificado por el controller (existe y es del usuario que pide).
 *  2. Se consulta M6 por el userId del PERFIL (no el de quien hace el request), reenviando el token.
 *  3. Si M6 está caído → respuesta degradada vacía (degraded: true), no 503, para no bloquear al usuario.
 *  4. El customerId que se devuelve es el interno de M2 (cust_xxx), no el userId de M1.
 */
export class TripsService {
  constructor(private readonly m6: M6Client = m6Client) {}

  async getTrips(customer: CustomerProfile, token: string): Promise<CustomerTripsResponse> {
    try {
      const response = await this.m6.getTrips(customer.userId, token);
      return { ...response, customerId: customer.customerId, degraded: false };
    } catch (err) {
      if (err instanceof ServiceUnavailableError) {
        console.warn(
          `[TripsService] M6 no disponible para userId=${customer.userId}. ` +
          `Devolviendo respuesta degradada vacía.`
        );
        return fallbackResponse(customer.customerId);
      }
      throw err;
    }
  }
}

export const tripsService = new TripsService();
