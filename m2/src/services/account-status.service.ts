import { accountStatusRepository, AccountStatusRepository } from '../repositories/account-status.repository.js';
import { customerRepository, CustomerRepository } from '../repositories/customer.repository.js';
import { customerCache } from '../cache/customer.cache.js';
import { soporteClient, SoporteClient } from '../clients/soporte.client.js';
import { ServiceUnavailableError } from '../errors/service-unavailable.error.js';
import type {
  AccountStatusResponse,
  AccountStatusEnum,
  UpdateAccountStatusDTO,
  UpdateAccountStatusInternalDTO
} from '../types/customer.js';

/**
 * Umbrales de penalizaciones vigentes que disparan bloqueo automático.
 * Se leen de variables de entorno para poder ajustarse sin recompilar.
 *   PENALIZACIONES_TEMPORAL   (default: 2) → 1..N → BLOQUEADO_TEMPORAL
 *   PENALIZACIONES_PERMANENTE (default: 3) → N+1.. → BLOQUEADO_PERMANENTE
 */
function getThresholds(): { temporal: number; permanente: number } {
  const temporal   = parseInt(process.env.PENALIZACIONES_TEMPORAL   ?? '2', 10);
  const permanente = parseInt(process.env.PENALIZACIONES_PERMANENTE ?? '3', 10);
  return { temporal, permanente };
}

/**
 * Determina el estado automático según la cantidad de penalizaciones vigentes.
 * Devuelve null si no alcanza el umbral mínimo (el cliente sigue con su estado actual).
 */
export function calcularEstadoAutomatico(
  totalPenalizaciones: number
): Extract<AccountStatusEnum, 'BLOQUEADO_TEMPORAL' | 'BLOQUEADO_PERMANENTE'> | null {
  const { temporal, permanente } = getThresholds();
  if (totalPenalizaciones >= permanente) return 'BLOQUEADO_PERMANENTE';
  if (totalPenalizaciones >= temporal)   return 'BLOQUEADO_TEMPORAL';
  return null;
}

/**
 * Servicio de estado de cuenta (RF-2.5).
 *
 * Reglas de negocio:
 *  1. Al consultar GET /status se recalcula con las penalizaciones de Soporte.
 *  2. Las penalizaciones tienen prioridad sobre el estado elegido manualmente.
 *  3. Solo los bloqueos AUTOMATICOS pueden revertirse automáticamente
 *     (si bajan las penalizaciones). Los bloqueos MANUALES son intocables por este servicio.
 *  4. Si Soporte está caído (ServiceUnavailableError) → se devuelve el último estado guardado
 *     sin modificarlo (degradación elegante).
 *  5. Si el estado cambia tras el recálculo → se persiste y se invalida la caché del perfil
 *     (el perfil cacheado incluye el status).
 */
export class AccountStatusService {
  constructor(
    private readonly repository: AccountStatusRepository = accountStatusRepository,
    // Solo lectura: para obtener el userId del perfil
    private readonly profiles: CustomerRepository = customerRepository,
    private readonly soporte: SoporteClient = soporteClient
  ) {}

  /**
   * RF-2.5: Consultar estado de cuenta.
   * Recalcula el estado con las penalizaciones vigentes de Soporte.
   * Si Soporte está caído devuelve el último estado persistido.
   *
   * @param customerId  ID interno del cliente (cust_xxx)
   *
   * El userId se obtiene del propio perfil guardado (no del request), para que
   * la consulta funcione igual con token de usuario o con X-Secret-Key.
   */
  async getAccountStatus(
    customerId: string
  ): Promise<AccountStatusResponse | null> {
    const saved = await this.repository.findAccountStatus(customerId);
    if (!saved) return null;

    // El userId para consultar Soporte sale del perfil, no del request
    const profile = await this.profiles.findById(customerId);
    if (!profile) return null;
    const userId = profile.userId;

    // Intentar recalcular con las penalizaciones de Soporte
    let totalPenalizaciones: number;
    try {
      const { total } = await this.soporte.getPenalizaciones(userId);
      totalPenalizaciones = total;
    } catch (err) {
      if (err instanceof ServiceUnavailableError) {
        // Soporte caído: degradación elegante → devolver el último estado guardado
        console.warn(
          `[AccountStatusService] Soporte no disponible para userId=${userId}. ` +
          `Devolviendo último estado guardado: ${saved.status}`
        );
        return saved;
      }
      throw err;
    }

    const estadoAutomatico = calcularEstadoAutomatico(totalPenalizaciones);

    // Caso 1: Las penalizaciones exigen un bloqueo
    if (estadoAutomatico !== null) {
      if (saved.status !== estadoAutomatico) {
        // El estado cambió → persistir y (cuando esté disponible) invalidar caché
        const reason = `Bloqueado automáticamente por ${totalPenalizaciones} penalización(es) vigente(s)`;
        const updated = await this.repository.updateAccountStatus(customerId, {
          status: estadoAutomatico,
          reason,
          blockOrigin: 'AUTOMATICO'
        });
        await customerCache.invalidate(customerId);
        return updated!;
      }
      // Ya estaba bloqueado con el nivel correcto → sin cambios
      return saved;
    }

    // Caso 2: Penalizaciones por debajo del umbral
    // Solo desbloquear si el bloqueo fue automático
    const esBloqueoAutomatico =
      saved.blockOrigin === 'AUTOMATICO' &&
      (saved.status === 'BLOQUEADO_TEMPORAL' || saved.status === 'BLOQUEADO_PERMANENTE');

    if (esBloqueoAutomatico) {
      const updated = await this.repository.updateAccountStatus(customerId, {
        status: 'ACTIVO',
        reason: 'Bloqueo automático levantado: sin penalizaciones vigentes',
        blockOrigin: undefined
      });
      await customerCache.invalidate(customerId);
      return updated!;
    }

    // Caso 3: Sin penalizaciones y sin bloqueo automático → sin cambios
    return saved;
  }

  /**
   * RF-2.5: Cambiar estado de cuenta manualmente (PUT /status).
   * Solo el dueño puede llamar esto (la verificación de ownership la hace el controller).
   * Registra el bloqueo como MANUAL para que no sea revertido automáticamente.
   *
   * @param customerId  ID interno del cliente
   * @param dto         { status, reason }
   */
  async updateAccountStatus(
    customerId: string,
    dto: UpdateAccountStatusDTO
  ): Promise<AccountStatusResponse | null> {
    const esBloqueo =
      dto.status === 'BLOQUEADO_TEMPORAL' || dto.status === 'BLOQUEADO_PERMANENTE';

    const internal: UpdateAccountStatusInternalDTO = {
      ...dto,
      blockOrigin: esBloqueo ? 'MANUAL' : undefined
    };

    const updated = await this.repository.updateAccountStatus(customerId, internal);
    if (updated) await customerCache.invalidate(customerId);
    return updated;
  }
}

export const accountStatusService = new AccountStatusService();
