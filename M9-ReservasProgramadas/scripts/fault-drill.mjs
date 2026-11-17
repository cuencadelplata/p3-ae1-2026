/**
 * Ensayo controlado de caída/recuperación de dependencias en una composición AISLADA.
 *
 *   node scripts/fault-drill.mjs [postgres|redis|rabbitmq|m7-stub ...] [--with-telemetry]
 *
 * - Usa el proyecto Compose `m9-fault-drill` con puertos propios (3100, 5532, 6479, 5772,
 *   15772): nunca detiene ni modifica el Compose habitual del usuario.
 * - Para cada dependencia: mide /health, /readiness y un POST /reservas antes, durante y
 *   después de detenerla. La restauración (`start`) está en un `finally`: se ejecuta siempre.
 * - Al terminar elimina SOLO el proyecto aislado y sus volúmenes propios (m9-fault-drill_*).
 * - No agrega endpoints públicos para inyectar fallos: usa `docker compose stop/start`.
 * - Con --with-telemetry suma docker-compose.observability.yml para ver el efecto en Grafana
 *   (requiere observability/.env.grafana-cloud).
 * Resultados: observability/resultados/fault-drill-<fecha>.json
 */
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const PROJECT = 'm9-fault-drill';
const root = path.resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const withTelemetry = args.includes('--with-telemetry');
const targets = args.filter((arg) => !arg.startsWith('--'));
const services = targets.length > 0 ? targets : ['m7-stub', 'redis', 'rabbitmq', 'postgres'];

const env = {
  ...process.env,
  PORT: '3100',
  M5_STUB_PORT: '3101',
  POSTGRES_PORT: '5532',
  REDIS_PORT: '6479',
  RABBITMQ_PORT: '5772',
  RABBITMQ_MANAGEMENT_PORT: '15772',
  ALLOY_UI_PORT: '12445',
  DOCKER_IMAGE: 'm9-reservas-programadas:fault-drill',
  DEPLOYMENT_ENVIRONMENT: 'fault-drill',
};
const files = [
  '-f',
  'docker-compose.yml',
  ...(withTelemetry ? ['-f', 'docker-compose.observability.yml'] : []),
];
const compose = (...rest) => {
  const result = spawnSync('docker', ['compose', '-p', PROJECT, ...files, ...rest], {
    cwd: root,
    env,
    encoding: 'utf8',
  });
  if (result.status !== 0) throw new Error(`docker compose ${rest.join(' ')}: ${result.stderr}`);
  return result.stdout;
};
const BASE = `http://127.0.0.1:${env.PORT}`;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const probe = async () => {
  const get = async (url) => {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
      return { status: response.status, body: await response.json().catch(() => null) };
    } catch (error) {
      return { status: 'sin respuesta', error: error.name };
    }
  };
  const health = await get(`${BASE}/health`);
  const readiness = await get(`${BASE}/readiness`);
  let create;
  try {
    const response = await fetch(`${BASE}/reservas`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-correlation-id': `fault-drill-${Date.now()}`,
      },
      body: JSON.stringify({
        clienteId: randomUUID(),
        origen: 'Origen ensayo',
        destino: 'Destino ensayo',
        vehiculo: 'AUTO',
        fechaHoraProgramada: new Date(Date.now() + 86_400_000).toISOString(),
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const body = await response.json().catch(() => null);
    create = {
      status: response.status,
      tarifaEstimada: body?.tarifaEstimada ?? null,
      codigo: body?.error?.codigo,
    };
  } catch (error) {
    create = { status: 'sin respuesta', error: error.name };
  }
  return { at: new Date().toISOString(), health, readiness, create };
};

const waitReady = async (timeoutMs = 180_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const response = await fetch(`${BASE}/readiness`).catch(() => null);
    if (response?.status === 200) return true;
    await wait(3_000);
  }
  return false;
};

const report = {
  project: PROJECT,
  withTelemetry,
  startedAt: new Date().toISOString(),
  results: [],
};
console.log(`Levantando composición aislada ${PROJECT} (puerto ${env.PORT})...`);
try {
  compose('--parallel', '1', 'up', '--build', '-d');
  if (!(await waitReady())) throw new Error('La composición aislada no quedó lista.');
  for (const service of services) {
    console.log(`\n== ${service}: antes / durante / después`);
    const entry = { service, before: await probe() };
    try {
      compose('stop', service);
      await wait(15_000);
      entry.during = await probe();
    } finally {
      // Restauración garantizada aunque falle la medición.
      compose('start', service);
    }
    entry.recovered = await waitReady();
    await wait(10_000); // deja que el Outbox drene el backlog acumulado
    entry.after = await probe();
    report.results.push(entry);
    console.log(JSON.stringify(entry, null, 2));
  }
} finally {
  report.finishedAt = new Date().toISOString();
  const dir = path.join(root, 'observability', 'resultados');
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `fault-drill-${report.startedAt.replace(/[:.]/g, '-')}.json`);
  writeFileSync(file, JSON.stringify(report, null, 2));
  console.log(`\nResultados: ${path.relative(root, file)}`);
  console.log(`Eliminando SOLO la composición aislada ${PROJECT}...`);
  try {
    compose('down', '--volumes', '--remove-orphans');
  } catch (error) {
    console.error(error.message);
  }
}
