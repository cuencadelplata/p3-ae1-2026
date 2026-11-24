import { Request, Response } from 'express';
import {
  accountStatusService,
  AccountStatusService,
  CuentaBloqueadaError,
  CuentaInactivaError
} from '../services/account-status.service.js';
import { DesbloqueoManualSchema, UpdateAccountStatusSchema, UserIdSchema } from '../types/customer.js';
import { findOwnedCustomer } from './ownership.js';

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
   * La autenticación la resuelve requireAuthOrServiceKey en la ruta:
   *   1. Bearer <token> validado por M1 → solo el dueño del perfil (req.auth definido).
   *   2. X-Secret-Key válida (otro módulo) → cualquier cliente (req.auth sin definir).
   *
   * La llamada a Soporte usa su propia secretKey (SOPORTE_SECRET_KEY),
   * no el token del solicitante.
   */
  getAccountStatus = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;

    // Con token de usuario, solo el dueño; con X-Secret-Key, cualquier cliente
    if (req.auth && !(await findOwnedCustomer(req, res, id))) return;

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
   * RF-2.5: Cambiar estado de cuenta — solo el dueño, con token de usuario (requireAuth).
   */
  updateAccountStatus = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;

    // El body se valida antes que el dueño: un estado inválido es 400 sin consultar la base
    const parseResult = UpdateAccountStatusSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({
        error: 'ValidationError',
        message: 'El estado enviado no es válido',
        details: parseResult.error.errors
      });
      return;
    }

    if (!(await findOwnedCustomer(req, res, id))) return;

    let updated;
    try {
      updated = await this.service.updateAccountStatus(id, parseResult.data);
    } catch (err) {
      if (err instanceof CuentaBloqueadaError) {
        res.status(409).json({ error: 'CuentaBloqueada', message: err.message });
        return;
      }
      throw err;
    }
    if (!updated) {
      res.status(404).json({
        error: 'CustomerNotFound',
        message: 'No se encontró un cliente con el ID proporcionado para actualizar'
      });
      return;
    }

    res.status(200).json(updated);
  };

  /**
   * POST /internal/usuarios/:userId/desbloqueo
   * Revisión manual de Soporte (M8): levanta el bloqueo y las penalizaciones vigentes hasta
   * ese momento dejan de contar. Autenticación: X-Secret-Key (requireSoporteKey).
   */
  desbloquearPorRevision = async (req: Request, res: Response): Promise<void> => {
    const userId = UserIdSchema.safeParse(Number(req.params.userId));
    const body = DesbloqueoManualSchema.safeParse(req.body ?? {});
    if (!userId.success || !body.success) {
      res.status(400).json({
        error: 'ValidationError',
        message: !userId.success
          ? 'userId debe ser el id numérico del usuario en M1'
          : 'El cuerpo debe tener motivo y operador',
        details: body.success ? undefined : body.error.errors
      });
      return;
    }

    let updated;
    try {
      updated = await this.service.desbloquearPorRevision(userId.data, body.data);
    } catch (err) {
      if (err instanceof CuentaInactivaError) {
        res.status(409).json({ error: 'CuentaInactiva', message: err.message });
        return;
      }
      throw err;
    }

    if (!updated) {
      res.status(404).json({
        error: 'CustomerNotFound',
        message: 'No hay un perfil de cliente para ese userId'
      });
      return;
    }

    res.status(200).json(updated);
  };
}

export const accountStatusController = new AccountStatusController();
