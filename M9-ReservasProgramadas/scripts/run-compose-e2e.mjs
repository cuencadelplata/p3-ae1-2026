import { spawnSync } from 'node:child_process';
import { request } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createDemoToken, DEMO_CLIENT_ID } from './integration-demo.mjs';
const directory = fileURLToPath(new URL('../', import.meta.url));
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('Ejecutar mediante npm run test:e2e.');
const project = 'm9-e2e-' + randomUUID().slice(0, 8);
const compose = ['compose', '-p', project, '-f', 'docker-compose.yml', '-f', 'compose.e2e.yml'];
const secret = randomBytes(48).toString('hex');
const env = {
  ...process.env,
  DOCKER_IMAGE: 'm9-e2e-fixture:local',
  RABBITMQ_EXCHANGE: 'm9.reservas.events',
  RABBITMQ_RETRY_EXCHANGE: 'm9.reservas.events.retry',
  RABBITMQ_DLQ_EXCHANGE: 'm9.reservas.events.dlx',
  ROUTE_STUB_DISTANCE_KM: '18.4',
  ROUTE_STUB_DURATION_MIN: '28',
  PORT: '3000',
  REDIS_PORT: '46380',
  POSTGRES_PORT: '45433',
  RABBITMQ_PORT: '45674',
  RABBITMQ_MANAGEMENT_PORT: '45675',
  POSTGRES_USER: 'm9',
  POSTGRES_PASSWORD: 'm9-local',
  POSTGRES_DB: 'm9_reservas',
  RABBITMQ_USER: 'm9',
  RABBITMQ_PASSWORD: 'm9-local',
  M9_DEMO_AUTH_SECRET: secret,
  RESERVATION_JOB_INTERVAL: '*/1 * * * * *',
};
const run = (command, args, environment = env) => {
  const result = spawnSync(command, args, {
    cwd: directory,
    env: environment,
    stdio: 'inherit',
    shell: false,
  });
  if (result.status !== 0) throw new Error('La prueba E2E fallo (codigo ' + result.status + ').');
};
async function waitReady(baseUrl) {
  const deadline = Date.now() + 180000;
  while (Date.now() < deadline) {
    try {
      const ready = await new Promise((resolve) => {
        const probe = request(baseUrl + '/readiness', { timeout: 3000 }, (response) => {
          response.resume();
          resolve(response.statusCode === 200);
        });
        probe.on('timeout', () => probe.destroy());
        probe.on('error', () => resolve(false));
        probe.end();
      });
      if (ready) return;
    } catch {
      /* Esperar la disponibilidad de los servicios del proyecto E2E. */
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error('M9 E2E no alcanzo readiness.');
}
let started = false;
try {
  run('docker', [...compose, 'config', '--quiet']);
  run('docker', [...compose, 'build', 'm9-reservas']);
  started = true;
  run('docker', [
    ...compose,
    'up',
    '--no-build',
    '-d',
    '--wait',
    '--wait-timeout',
    '240',
    'postgres',
    'redis',
    'rabbitmq',
  ]);
  run('docker', [
    ...compose,
    'up',
    '--no-build',
    '-d',
    '--wait',
    '--wait-timeout',
    '240',
    'm5-stub',
    'm7-stub',
  ]);
  run('docker', [...compose, 'up', '--no-build', '-d', 'm9-reservas']);
  const published = spawnSync('docker', [...compose, 'port', 'm9-reservas', '3000'], {
    cwd: directory,
    env,
    encoding: 'utf8',
  });
  const address = published.stdout.trim();
  if (published.status !== 0 || !/^127\.0\.0\.1:\d+$/.test(address))
    throw new Error('No se obtuvo el puerto privado del E2E.');
  const baseUrl = 'http://' + address;
  await waitReady(baseUrl);
  run(process.execPath, [npmCli, 'run', 'test:e2e:only'], {
    ...env,
    E2E_BASE_URL: baseUrl,
    E2E_AUTH_TOKEN: createDemoToken(secret),
    E2E_CLIENT_ID: DEMO_CLIENT_ID,
  });
} catch (error) {
  spawnSync('docker', [...compose, 'logs', '--tail', '20'], {
    cwd: directory,
    env,
    stdio: 'inherit',
  });
  throw error;
} finally {
  // El proyecto aleatorio es exclusivo de este proceso; nunca se baja el stack del usuario.
  if (started) run('docker', [...compose, 'down', '--volumes', '--remove-orphans']);
}
