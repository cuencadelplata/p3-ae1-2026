import { Request, Response } from 'express';
import { accountStatusService, AccountStatusService } from '../services/account-status.service.js';
import { UpdateAccountStatusSchema } from '../types/customer.js';

/**
 * Controller de RF-2.5 (Estado de Cuenta).
 * Separado del CustomerController para que Erwin y Leandro no toquen el mismo archivo.
 */
export class AccountStatusController {
  constructor(private readonly service: AccountStatusService = accountStatusService) {}

  /**
   * GET /v1/customers/:id/status
   * RF-2.5: Consultar estado de cuenta (recalcula con penalizaciones de Soporte).
   *
   * Autenticación: acepta DOS mecanismos (uno es suficiente):
   *   1. Authorization: Bearer <token>  — viene del front o de cualquier módulo autenticado
   *   2. X-Secret-Key: <key>            — viene de módulos internos (M5, cron, etc.)
   *
   * La llamada a Soporte usa su propia secretKey (SOPORTE_SECRET_KEY),
   * no el token del solicitante.
   */
  getAccountStatus = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;

    const hasToken     = !!req.headers.authorization?.startsWith('Bearer ');
    const secretKey    = process.env.STATUS_SECRET_KEY;
    const hasSecretKey = !!secretKey && req.headers['x-secret-key'] === secretKey;

    if (!hasToken && !hasSecretKey) {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Se requiere Authorization: Bearer <token> o X-Secret-Key'
      });
      return;
    }

    // El service obtiene el userId desde el perfil (customerId → userId),
    // así funciona igual con token de usuario o con X-Secret-Key.
    const statusInfo = await this.service.getAccountStatus(id);

    if (!statusInfo) {
      res.status(404).json({
        error: 'CustomerNotFound',
        message: 'No se encontró un cliente con el ID proporcionado'
      });
      return;
    }

    res.status(200).json(statusInfo);
  };

  /**
   * PUT /v1/customers/:id/status
   * RF-2.5: Cambiar estado de cuenta — solo el dueño, con token de usuario.
   */
  updateAccountStatus = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;

    const token = req.headers.authorization?.replace('Bearer ', '') ?? '';
    if (!token) {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Token requerido'
      });
      return;
    }

    // TODO (E6): verificar que req.auth.userId corresponde al customer con id = :id
    // Cuando findByUserId esté disponible:
    //   const profile = await customerRepository.findById(id);
    //   if (!profile || profile.userId !== auth.userId) {
    //     res.status(403).json({ error: 'Forbidden', message: 'Solo el dueño puede modificar su estado' });
    //     return;
    //   }

    const parseResult = UpdateAccountStatusSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({
        error: 'ValidationError',
        message: 'El estado enviado no es válido',
        details: parseResult.error.errors
      });
      return;
    }

    const updated = await this.service.updateAccountStatus(id, parseResult.data);
    if (!updated) {
      res.status(404).json({
        error: 'CustomerNotFound',
        message: 'No se encontró un cliente con el ID proporcionado para actualizar'
      });
      return;
    }

    res.status(200).json(updated);
  };
}

export const accountStatusController = new AccountStatusController();
