/**
 * Chequeos de salud de las dependencias externas de Leandro (RF-2.3 y RF-2.5).
 *
 * Cada check hace una llamada liviana al /health del stub (o del módulo real)
 * y devuelve true si responde bien, como espera registerHealthCheck.
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

export async function checkSoporte(): Promise<boolean> {
  const base = process.env.SOPORTE_SERVICE_URL ?? 'http://localhost:3000/__stubs/soporte';
  return (await pingService(`${base}/health`)).ok;
}

export async function checkM6(): Promise<boolean> {
  const base = process.env.M6_SERVICE_URL ?? 'http://localhost:3000/__stubs/m6';
  return (await pingService(`${base}/health`)).ok;
}
