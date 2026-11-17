import { ExternalServiceError } from '../errors/external-service.error.js';
import { dependencyTarget, now, recordDependencyCall } from '../observability/metrics.js';

const statusOutcome = (status: number): string => {
  if (status >= 200 && status < 300) return 'success';
  if (status >= 500) return 'http_5xx';
  if (status >= 400) return 'http_4xx';
  return 'http_other';
};

/**
 * fetch con timeout. Registra duración y resultado por dependencia/operación; el span
 * cliente y la propagación `traceparent` los agrega la instrumentación de undici.
 */
export const fetchWithTimeout = async (
  service: string,
  input: URL,
  init: RequestInit,
  timeoutMs: number,
  operation = 'request',
): Promise<Response> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startMs = now();
  const target = dependencyTarget(input);
  try {
    const response = await fetch(input, { ...init, signal: controller.signal });
    recordDependencyCall({
      dependency: service,
      operation,
      outcome: statusOutcome(response.status),
      target,
      startMs,
    });
    return response;
  } catch (cause) {
    const timedOut = controller.signal.aborted;
    recordDependencyCall({
      dependency: service,
      operation,
      outcome: timedOut ? 'timeout' : 'unavailable',
      target,
      startMs,
    });
    if (timedOut) throw ExternalServiceError.timeout(service, cause);
    throw ExternalServiceError.unavailable(service, cause);
  } finally {
    clearTimeout(timer);
  }
};
