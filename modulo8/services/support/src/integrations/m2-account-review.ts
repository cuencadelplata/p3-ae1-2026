import { SupportError } from '../errors/support-error.js';

interface AccountReview {
  userId: number;
  operatorId: number;
  ticketId: string;
  motive: string;
  correlationId: string;
}

export type AccountUnlocker = (review: AccountReview) => Promise<{ userId: number; status: 'ACTIVO' }>;

function accountServiceUnavailable(): SupportError {
  return new SupportError(503, 'SUPPORT_ACCOUNT_SERVICE_UNAVAILABLE', 'No fue posible confirmar el desbloqueo en M2.');
}

export function createM2AccountUnlocker(baseUrl: string, secret: string, fetchImpl = fetch): AccountUnlocker {
  const url = baseUrl.replace(/\/+$/, '');
  return async ({ userId, operatorId, ticketId, motive, correlationId }) => {
    const response = await fetchImpl(`${url}/internal/usuarios/${userId}/desbloqueo`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Secret-Key': secret,
        'X-Correlation-Id': correlationId,
      },
      body: JSON.stringify({ operador: String(operatorId), ticketId, motivo: motive }),
      signal: AbortSignal.timeout(3000),
      redirect: 'error',
    }).catch(() => { throw accountServiceUnavailable(); });

    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      if (response.status === 404) {
        throw new SupportError(404, 'SUPPORT_CUSTOMER_NOT_FOUND', 'El cliente no tiene un perfil en M2.');
      }
      if (response.status === 409) {
        throw new SupportError(409, 'SUPPORT_INVALID_TRANSITION', 'M2 no permite desbloquear una cuenta inactiva.');
      }
      throw accountServiceUnavailable();
    }

    const body = await response.json().catch(() => null);
    if (body?.status !== 'ACTIVO') throw accountServiceUnavailable();
    return { userId, status: 'ACTIVO' };
  };
}
