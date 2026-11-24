/**
 * Ejecuta un escenario k6 de M9 y registra metadatos reproducibles de la corrida.
 *
 *   node scripts/run-k6.mjs <escenario> [--cloud] [--host-k6]
 *
 * Por defecto usa la imagen grafana/k6 DENTRO de la red Compose (BASE_URL=http://m9-reservas:3000),
 * así no hace falta instalar k6 en Windows. Con --host-k6 usa el binario `k6` local contra
 * http://localhost:3000. Con --cloud ejecuta `k6 cloud run --local-execution`: el generador
 * corre en esta PC y solo los RESULTADOS van a Grafana Cloud k6 (los generadores cloud no
 * pueden llegar al localhost de esta máquina). Se usa --no-archive-upload para no subir scripts.
 *
 * Secretos: solo se pasan K6_CLOUD_TOKEN / K6_CLOUD_STACK_ID / K6_CLOUD_PROJECT_ID leídos de
 * observability/.env.grafana-cloud; el token de ingesta OTLP nunca llega a k6.
 */
import { createDemoToken } from './integration-demo.mjs';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const K6_IMAGE = 'grafana/k6:2.3.0';
const DEMO_CLIENT_ID = '99999999-9999-4999-8999-999999999999';

const detectActiveNetwork = () => {
  if (process.env.K6_DOCKER_NETWORK) return process.env.K6_DOCKER_NETWORK;
  const probe = spawnSync(
    'docker',
    ['ps', '--filter', 'label=com.docker.compose.service=m9-reservas', '--format', '{{.Networks}}'],
    { encoding: 'utf8' },
  );
  const net = (probe.stdout || '').trim().split(/\r?\n/)[0]?.split(',')[0]?.trim();
  return net || 'm9-reservas-programadas_reservas-network';
};

const NETWORK = detectActiveNetwork();
const SCENARIOS = [
  'smoke',
  'load',
  'stress',
  'spike',
  'cache',
  'concurrency',
  'activation',
  'dispatch',
  'repricing',
  'parallel',
  'breakpoint',
  'soak',
];
const PASSTHROUGH = [
  'PROFILE',
  'CLIENT_ID',
  'VUS',
  'DURATION',
  'MODE',
  'STRESS_STEPS',
  'STRESS_RPS',
  'PRE_ALLOCATED_VUS',
  'MAX_VUS',
  'BASE_VUS',
  'SPIKE_VUS',
  'CACHE_SET_SIZE',
  'CACHE_TTL_SECONDS',
  'SHARED_RESERVATIONS',
  'ITERATIONS',
  'ACTIVATION_LEAD_SECONDS',
  'ACTIVATION_TIMEOUT_SECONDS',
  'POLL_INTERVAL_SECONDS',
  'THINK_TIME_SECONDS',
  'BATCH_SIZE',
  'REQUEST_TIMEOUT',
  'BREAKPOINT_RPS',
  'BASELINE_RPS',
  'BASELINE_DURATION',
  'RAMP_DURATION',
  'STEP_DURATION',
  'RECOVERY_DURATION',
  'SPIKE_WAVES',
  'SPIKE_RAMP_DURATION',
  'SPIKE_HOLD_DURATION',
];
const CLOUD_VARS = ['K6_CLOUD_TOKEN', 'K6_CLOUD_STACK_ID', 'K6_CLOUD_PROJECT_ID'];

const [scenario, ...flags] = process.argv.slice(2);
if (!SCENARIOS.includes(scenario)) {
  console.error(`Uso: node scripts/run-k6.mjs <${SCENARIOS.join('|')}> [--cloud] [--host-k6]`);
  process.exit(2);
}
const cloud = flags.includes('--cloud');
const hostK6 = flags.includes('--host-k6');
const moduleDir = path.resolve(import.meta.dirname, '..');
const resultsDir = path.join(moduleDir, 'performance', 'results');
mkdirSync(resultsDir, { recursive: true });

const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '');
const runId = process.env.RUN_ID ?? `${scenario}-${stamp}`;
const baseUrl =
  process.env.BASE_URL ?? (hostK6 ? 'http://localhost:3000' : 'http://m9-reservas:3000');

const readCloudEnv = () => {
  const file = path.join(moduleDir, 'observability', '.env.grafana-cloud');
  const values = {};
  if (existsSync(file)) {
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (match && CLOUD_VARS.includes(match[1])) values[match[1]] = match[2];
    }
  }
  for (const name of CLOUD_VARS) if (process.env[name]) values[name] = process.env[name];
  if (!values.K6_CLOUD_TOKEN || values.K6_CLOUD_TOKEN === 'REEMPLAZAR') {
    console.error(
      'Falta K6_CLOUD_TOKEN en observability/.env.grafana-cloud (ver guía Grafana Cloud).',
    );
    process.exit(2);
  }
  return values;
};

const scriptEnv = { BASE_URL: baseUrl, RUN_ID: runId, SCENARIO_NAME: scenario };
if (NETWORK === 'movilidad-urbana_reservas-network' || flags.includes('--integration')) {
  scriptEnv.CLIENT_ID = DEMO_CLIENT_ID;
}
for (const name of PASSTHROUGH)
  if (process.env[name] !== undefined) scriptEnv[name] = process.env[name];
const cloudEnv = cloud ? readCloudEnv() : {};
let authToken = process.env.M9_AUTH_TOKEN;
if (!authToken && scriptEnv.CLIENT_ID === DEMO_CLIENT_ID) {
  const authPath = path.join(moduleDir, '.integration', 'demo-auth.json');
  if (existsSync(authPath))
    authToken = createDemoToken(JSON.parse(readFileSync(authPath, 'utf8')).secret);
}
if (!authToken)
  throw new Error(
    'Configurar M9_AUTH_TOKEN con una sesion valida; la demo usa .integration/demo-auth.json.',
  );
authToken = authToken.replace(/^Bearer\s+/i, '').trim();
const privateEnv = { M9_AUTH_TOKEN: authToken };
if (!scriptEnv.CLIENT_ID) {
  const claims = JSON.parse(Buffer.from(authToken.split('.')[1], 'base64url').toString('utf8'));
  scriptEnv.CLIENT_ID = String(claims.userId ?? claims.sub ?? '');
  if (!scriptEnv.CLIENT_ID) throw new Error('Configurar CLIENT_ID para la sesion de k6.');
}

const k6Args = [
  ...(cloud
    ? [
        'cloud',
        'run',
        '--local-execution',
        '--no-archive-upload',
        '--include-system-env-vars',
        '--no-cloud-secrets',
        '--no-cloud-logs',
      ]
    : ['run']),
  ...Object.entries(scriptEnv).flatMap(([key, value]) => ['-e', `${key}=${value}`]),
  `performance/k6/${scenario}.js`,
];

let command;
let args;
if (hostK6) {
  command = 'k6';
  args = k6Args;
} else {
  command = 'docker';
  args = [
    'run',
    '--rm',
    '--network',
    NETWORK,
    '-v',
    `${path.join(moduleDir, 'performance')}:/work/performance`,
    '-w',
    '/work',
    ...Object.keys({ ...cloudEnv, ...privateEnv }).flatMap((name) => ['-e', name]),
    K6_IMAGE,
    ...k6Args,
  ];
}

const versionProbe = hostK6
  ? spawnSync('k6', ['version'], { encoding: 'utf8' })
  : spawnSync('docker', ['run', '--rm', K6_IMAGE, 'version'], { encoding: 'utf8' });

const metadata = {
  scenario,
  runId,
  startedAt: new Date().toISOString(),
  mode: cloud ? 'cloud run --local-execution (resultados a Grafana Cloud k6)' : 'run local',
  generator: hostK6 ? 'k6 instalado en el host' : `contenedor ${K6_IMAGE} en red ${NETWORK}`,
  k6Version: (versionProbe.stdout || versionProbe.stderr || 'desconocida').trim(),
  baseUrl,
  parameters: scriptEnv,
  authTokenSource: process.env.M9_AUTH_TOKEN ? 'provided-session' : 'generated-demo',
  host: {
    platform: `${os.platform()} ${os.release()}`,
    cpus: os.cpus().length,
    cpuModel: os.cpus()[0]?.model,
    totalMemoryGb: Math.round((os.totalmem() / 1024 ** 3) * 10) / 10,
  },
  generatorSharesMachineWithApp: true,
  note: 'Generador y aplicación comparten equipo: los resultados incluyen esa contención.',
};

console.log(`k6 ${scenario} · RUN_ID=${runId} · ${metadata.generator}`);
const result = spawnSync(command, args, {
  cwd: moduleDir,
  stdio: 'inherit',
  env: { ...process.env, ...cloudEnv, ...privateEnv },
});
metadata.finishedAt = new Date().toISOString();
metadata.exitCode = result.status;
metadata.thresholdsPassed = result.status === 0 ? true : result.status === 99 ? false : null;
metadata.executionError = result.error?.message ?? null;
writeFileSync(
  path.join(resultsDir, `${scenario}-${runId}.meta.json`),
  JSON.stringify(metadata, null, 2),
);
console.log(
  `Resultado: ${result.status === 0 ? 'thresholds OK' : `código ${result.status} (thresholds incumplidos o error)`}` +
    ` · resumen en performance/results/${scenario}-${runId}.json`,
);
// Se propaga el código de k6: un incumplimiento NO se oculta.
process.exit(result.status ?? 1);
