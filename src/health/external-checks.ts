/**
 * Chequeos de salud de las dependencias externas de Leandro (RF-2.3 y RF-2.5).
 *
 * Para registrarlos, llamar a registerExternalHealthChecks(registry) desde app.ts
 * una vez que Erwin haya creado src/health/registry.ts (paso E9).
 *
 * Cada check hace una llamada liviana al /health del stub (o del módulo real)
 * y devuelve { ok, latencyMs, detail? }.
 */

const TIMEOUT_MS = 3_000;

type HealthCheckResult = {
  ok: boolean;
  latencyMs: number;
  detail?: string;
};

async function pingService(url: string): Promise<HealthCheckResult> {
  const start = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(url, { signal: controller.signal });
    const latencyMs = Date.now() - start;
    if (res.ok) return { ok: true, latencyMs };
    return { ok: false, latencyMs, detail: `HTTP ${res.status}` };
  } catch (err: any) {
    return {
      ok: false,
      latencyMs: Date.now() - start,
      detail: err?.name === 'AbortError' ? `Timeout (>${TIMEOUT_MS} ms)` : (err?.message ?? String(err))
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function checkSoporte(): Promise<HealthCheckResult> {
  const base = process.env.SOPORTE_SERVICE_URL ?? 'http://localhost:3000/__stubs/soporte';
  return pingService(`${base}/health`);
}

export async function checkM6(): Promise<HealthCheckResult> {
  const base = process.env.M6_SERVICE_URL ?? 'http://localhost:3000/__stubs/m6';
  return pingService(`${base}/health`);
}

/**
 * Registra los chequeos de soporte y M6 en el registry de salud de Erwin.
 * Llamar desde app.ts después de que registry.ts esté disponible:
 *
 *   import { registerHealthCheck } from './health/registry.js';
 *   import { registerExternalHealthChecks } from './health/external-checks.js';
 *   registerExternalHealthChecks(registerHealthCheck);
 *
 * @param registerHealthCheck  Función del registry de Erwin: (name, checkFn) => void
 */
export function registerExternalHealthChecks(
  registerHealthCheck: (name: string, check: () => Promise<HealthCheckResult>) => void
): void {
  registerHealthCheck('soporte', checkSoporte);
  registerHealthCheck('m6', checkM6);
}
