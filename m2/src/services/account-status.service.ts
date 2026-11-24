import { accountStatusRepository, AccountStatusRepository } from '../repositories/account-status.repository.js';
import { customerRepository, CustomerRepository } from '../repositories/customer.repository.js';
import { customerCache } from '../cache/customer.cache.js';
import { soporteClient, SoporteClient, type PenalizacionesResponse } from '../clients/soporte.client.js';
import { ServiceUnavailableError } from '../errors/service-unavailable.error.js';
import type {
  AccountStatusResponse,
  AccountStatusEnum,
  UpdateAccountStatusDTO,
  UpdateAccountStatusInternalDTO,
  DesbloqueoManualDTO,
  UserId
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
 * Cuenta las penalizaciones vigentes que todavía no evaluó un operador.
 * Sin revisión manual previa se usa el total que informa Soporte (M8 ya filtra las
 * vigentes de los últimos 90 días). Con revisión, solo cuentan las posteriores a ella:
 * las anteriores ya las vio el operador al desbloquear. Una fecha ilegible se cuenta
 * (ante la duda, no se pierde una penalización).
 */
export function contarPenalizacionesSinRevisar(
  respuesta: PenalizacionesResponse,
  reviewedAt?: string
): number {
  if (!reviewedAt) return respuesta.total;
  const revision = Date.parse(reviewedAt);
  if (Number.isNaN(revision)) return respuesta.total;
  return respuesta.penalizaciones.filter((p) => {
    const fecha = Date.parse(p.fecha);
    return Number.isNaN(fecha) || fecha > revision;
  }).length;
}

const BLOQUEOS: readonly AccountStatusEnum[] = ['BLOQUEADO_TEMPORAL', 'BLOQUEADO_PERMANENTE'];

/** El cliente no puede cambiar su estado mientras tiene un bloqueo por penalizaciones. */
export class CuentaBloqueadaError extends Error {
  constructor(readonly status: AccountStatusEnum) {
    super(`La cuenta tiene un bloqueo automático (${status}): solo lo levanta Soporte`);
    this.name = 'CuentaBloqueadaError';
  }
}

/** Una cuenta dada de baja (INACTIVO) no se reactiva por revisión de bloqueo. */
export class CuentaInactivaError extends Error {
  constructor() {
    super('La cuenta está dada de baja (INACTIVO): no hay bloqueo que revisar');
    this.name = 'CuentaInactivaError';
  }
}

/**
 * Servicio de estado de cuenta (RF-2.5).
 *
 * Reglas de negocio:
 *  1. Al consultar GET /status se recalcula con las penalizaciones de Soporte.
 *  2. Las penalizaciones tienen prioridad sobre el estado elegido manualmente.
 *  3. Solo los bloqueos TEMPORALES automáticos se revierten solos (si bajan las penalizaciones).
 *     BLOQUEADO_PERMANENTE no se recalcula: lo levanta únicamente la revisión manual de
 *     Soporte (desbloquearPorRevision). Los bloqueos MANUALES tampoco se tocan.
 *  3b. Tras una revisión manual solo cuentan las penalizaciones posteriores a ella, así el
 *     siguiente recálculo respeta la decisión del operador aunque sigan vigentes en M8.
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

    // El bloqueo permanente no se recalcula: solo lo levanta la revisión manual de Soporte
    if (saved.status === 'BLOQUEADO_PERMANENTE') return saved;

    // Intentar recalcular con las penalizaciones de Soporte
    let totalPenalizaciones: number;
    try {
      const respuesta = await this.soporte.getPenalizaciones(userId);
      totalPenalizaciones = contarPenalizacionesSinRevisar(respuesta, saved.reviewedAt);
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
    // Solo desbloquear si el bloqueo fue automático (el permanente ya salió más arriba)
    const esBloqueoAutomatico =
      saved.blockOrigin === 'AUTOMATICO' && saved.status === 'BLOQUEADO_TEMPORAL';

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
    // Con un bloqueo por penalizaciones vigente el cliente no puede cambiar su estado
    // (ni darse de alta ni de baja): lo levanta el recálculo o la revisión de Soporte.
    const actual = await this.repository.findAccountStatus(customerId);
    if (actual && actual.blockOrigin === 'AUTOMATICO' && BLOQUEOS.includes(actual.status)) {
      throw new CuentaBloqueadaError(actual.status);
    }

    const esBloqueo = BLOQUEOS.includes(dto.status);

    const internal: UpdateAccountStatusInternalDTO = {
      ...dto,
      blockOrigin: esBloqueo ? 'MANUAL' : undefined
    };

    const updated = await this.repository.updateAccountStatus(customerId, internal);
    if (updated) await customerCache.invalidate(customerId);
    return updated;
  }

  /**
   * Revisión manual de Soporte (M8): POST /internal/usuarios/:userId/desbloqueo.
   *
   * Levanta cualquier bloqueo (temporal o permanente, automático o manual) y EN_REVISIÓN,
   * y registra la fecha de revisión: las penalizaciones anteriores ya no cuentan, aunque
   * sigan vigentes en M8. Una penalización nueva (posterior) vuelve a contar.
   *
   * - Perfil inexistente → null (404).
   * - Cuenta ACTIVO → se devuelve sin cambios (idempotente: M8 puede reintentar).
   * - Cuenta INACTIVO (baja) → CuentaInactivaError (409).
   */
  async desbloquearPorRevision(
    userId: UserId,
    dto: DesbloqueoManualDTO
  ): Promise<AccountStatusResponse | null> {
    const profile = await this.profiles.findByUserId(userId);
    if (!profile) return null;

    const saved = await this.repository.findAccountStatus(profile.customerId);
    if (!saved) return null;
    if (saved.status === 'ACTIVO') return saved;
    if (saved.status === 'INACTIVO') throw new CuentaInactivaError();

    const ticket = dto.ticketId ? `, ticket ${dto.ticketId}` : '';
    const updated = await this.repository.updateAccountStatus(profile.customerId, {
      status: 'ACTIVO',
      reason: `Desbloqueado por revisión manual de Soporte (operador ${dto.operador}${ticket}): ${dto.motivo}`,
      blockOrigin: undefined,
      reviewedAt: new Date().toISOString()
    });
    if (updated) await customerCache.invalidate(profile.customerId);
    return updated;
  }
}

export const accountStatusService = new AccountStatusService();
