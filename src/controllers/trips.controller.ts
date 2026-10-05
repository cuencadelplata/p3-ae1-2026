import { Request, Response } from 'express';
import { tripsService, TripsService } from '../services/trips.service.js';

/**
 * Controller de RF-2.3 (Historial de Viajes).
 * Separado del CustomerController para que Erwin y Leandro no toquen el mismo archivo.
 */
export class TripsController {
  constructor(private readonly service: TripsService = tripsService) {}

  /**
   * GET /v1/customers/:id/trips
   * RF-2.3: Consultar historial de viajes del cliente.
   *
   * Requiere token válido. requireAuth (E7 de Erwin) inyecta req.auth = { userId, role, token }.
   * Fallback temporal: leer Authorization header directo.
   */
  getCustomerTrips = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;

    const auth = (req as any).auth as { userId: number; token: string } | undefined;
    const token = auth?.token ?? req.headers.authorization?.replace('Bearer ', '') ?? '';
    const userId = auth?.userId ?? 0;

    if (!token) {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Token requerido'
      });
      return;
    }

    const trips = await this.service.getTrips(id, userId, token);

    if (!trips) {
      res.status(404).json({
        error: 'CustomerNotFound',
        message: 'No se encontró un cliente con el ID proporcionado'
      });
      return;
    }

    res.status(200).json(trips);
  };
}

export const tripsController = new TripsController();
