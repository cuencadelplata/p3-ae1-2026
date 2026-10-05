import { Request, Response } from 'express';
import { tripsService, TripsService } from '../services/trips.service.js';
import { findOwnedCustomer } from './ownership.js';

/**
 * Controller de RF-2.3 (Historial de Viajes).
 * Separado del CustomerController para que Erwin y Leandro no toquen el mismo archivo.
 */
export class TripsController {
  constructor(private readonly service: TripsService = tripsService) {}

  /**
   * GET /v1/customers/:id/trips
   * RF-2.3: Consultar historial de viajes del cliente. Requiere token (requireAuth)
   * y solo lo ve el dueño del perfil: M6 se consulta con el userId del perfil.
   */
  getCustomerTrips = async (req: Request, res: Response): Promise<void> => {
    const customer = await findOwnedCustomer(req, res, req.params.id);
    if (!customer) return;

    res.status(200).json(await this.service.getTrips(customer));
  };
}

export const tripsController = new TripsController();
