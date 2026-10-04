import { ExternalServiceError } from '../errors/external-service.error.js';

export const fetchWithTimeout = async (
  service: string,
  input: URL,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (cause) {
    if (controller.signal.aborted) throw ExternalServiceError.timeout(service, cause);
    throw ExternalServiceError.unavailable(service, cause);
  } finally {
    clearTimeout(timer);
  }
};
