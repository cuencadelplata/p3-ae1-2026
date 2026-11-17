#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'dotenv';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const moduleDir = path.resolve(scriptDir, '../..');
const mode = (process.argv[2] || '').toLowerCase();
if (!new Set(['support', 'qr', 'receipts', 'resend', 'delivery', 'mixed']).has(mode)) {
  console.error('Uso: node tests/stress/run-load.mjs <support|qr|receipts|resend|delivery|mixed>');
  process.exit(2);
}

const envPath = path.join(moduleDir, '.env');
const localEnv = existsSync(envPath) ? parse(readFileSync(envPath)) : {};
const get = (name) => process.env[name] || localEnv[name] || '';
const vus = Number(process.argv[4] || get('LOAD_VUS') || 5);
const durationSeconds = Number(get('LOAD_DURATION_SECONDS') || 10);
const port = Number(get('M8_HOST_PORT') || 8000);
const pattern = process.argv[3] || get('LOAD_PATTERN') || 'ramp';
if (!Number.isInteger(vus) || vus < 1 || vus > 1200
    || !Number.isInteger(durationSeconds) || durationSeconds < 5 || durationSeconds > 300
    || !Number.isInteger(port) || port < 1 || port > 65535
    || !['ramp', 'constant', 'step45'].includes(pattern)) {
  console.error('LOAD_VUS: 1..1200; LOAD_DURATION_SECONDS: 5..300; M8_HOST_PORT: puerto válido.');
  process.exit(2);
}

function dockerOutput(args) {
  const result = spawnSync('docker', args, { cwd: moduleDir, encoding: 'utf8' });
  if (result.status !== 0) {
    console.error('No se encontro el contenedor M8 en Compose. Ejecutar pnpm run ensure:stack.');
    process.exit(2);
  }
  return result.stdout.trim();
}

const appContainer = dockerOutput(['compose', '--env-file', '.env', 'ps', '-q', 'm8-app']);
if (!appContainer) {
  console.error('m8-app no esta iniciado. Ejecutar pnpm run ensure:stack.');
  process.exit(2);
}
const dockerNetwork = dockerOutput(['inspect', '--format',
  '{{range $name, $network := .NetworkSettings.Networks}}{{println $name}}{{end}}', appContainer])
  .split(/\r?\n/).find(Boolean);
if (!dockerNetwork || !/^[a-zA-Z0-9_.-]+$/.test(dockerNetwork)) {
  console.error('No se pudo identificar la red Docker de m8-app.');
  process.exit(2);
}

let targetUrl = get('TARGET_URL') || 'http://m8-app:3000';
let parsedTarget;
try {
  parsedTarget = new URL(targetUrl);
} catch {
  console.error('TARGET_URL debe ser una URL HTTP válida.');
  process.exit(2);
}
if (!['http:', 'https:'].includes(parsedTarget.protocol)
    || parsedTarget.username || parsedTarget.password || parsedTarget.search || parsedTarget.hash) {
  console.error('TARGET_URL debe ser HTTP(S) y no contener credenciales, query ni fragmento.');
  process.exit(2);
}
if (['localhost', '127.0.0.1'].includes(parsedTarget.hostname)) {
  parsedTarget.hostname = 'host.docker.internal';
}
targetUrl = parsedTarget.toString().replace(/\/$/, '');
const qrKey = get('QR_INTERNAL_API_KEY');
const jwtSecret = get('M1_JWT_SECRET');
if (['qr', 'mixed'].includes(mode) && (!qrKey || qrKey.startsWith('replace-with-'))) {
  console.error('Configurar QR_INTERNAL_API_KEY en modulo8/.env.');
  process.exit(2);
}
if (['delivery', 'mixed'].includes(mode) && (!jwtSecret || jwtSecret.startsWith('replace-with-'))) {
  console.error('Configurar M1_JWT_SECRET en modulo8/.env.');
  process.exit(2);
}

const resultsDir = path.join(scriptDir, 'results');
mkdirSync(resultsDir, { recursive: true });
const requestedResult = get('LOAD_RESULT_NAME');
if (requestedResult && !/^[a-zA-Z0-9_-]+\.json$/.test(requestedResult)) {
  console.error('LOAD_RESULT_NAME debe ser un nombre .json sin rutas.');
  process.exit(2);
}
const resultFile = requestedResult || `${mode}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
const childEnv = {
  ...process.env,
  TARGET_URL: targetUrl,
  LOAD_MODE: mode,
  LOAD_VUS: String(vus),
  LOAD_DURATION_SECONDS: String(durationSeconds),
  LOAD_PATTERN: pattern,
  RUN_ID: randomUUID(),
  QR_INTERNAL_API_KEY: qrKey,
  M1_JWT_SECRET: jwtSecret,
};
const args = [
  'run', '--rm',
  '--network', dockerNetwork,
  '--add-host', 'host.docker.internal:host-gateway',
  '--volume', `${scriptDir}:/scripts:ro`,
  '--volume', `${resultsDir}:/results`,
  ...['TARGET_URL', 'LOAD_MODE', 'LOAD_VUS', 'LOAD_DURATION_SECONDS', 'LOAD_PATTERN', 'RUN_ID',
    'QR_INTERNAL_API_KEY', 'M1_JWT_SECRET'].flatMap((name) => ['-e', name]),
  'grafana/k6:2.4.0', 'run', '--summary-export', `/results/${resultFile}`, '/scripts/load-m8.js',
];

const shape = pattern === 'constant' ? `${durationSeconds}s constantes`
  : pattern === 'step45' ? 'rampa incremental de 45s'
    : `${durationSeconds}s de subida y ${durationSeconds}s estables`;
console.log(`Carga ${mode}: ${shape}, máximo ${vus} VU contra ${targetUrl}`);
console.log(`Resumen local: tests/stress/results/${resultFile}`);
const child = spawn('docker', args, { stdio: 'inherit', env: childEnv });
child.on('error', (error) => {
  console.error(`No se pudo iniciar Docker: ${error.message}`);
  process.exitCode = 1;
});
child.on('exit', (code) => {
  if (pattern === 'step45') {
    const summaryPath = path.join(resultsDir, resultFile);
    if (existsSync(summaryPath)) {
      const summary = JSON.parse(readFileSync(summaryPath, 'utf8'));
      const stages = [1, 2, 3, 4, 5].map((stage) => ({
        stage,
        targetVus: Math.max(1, Math.round(vus * stage / 5)),
        requests: summary.metrics[`m8_ramp_stage_${stage}_requests`]?.count ?? 0,
        failures: summary.metrics[`m8_ramp_stage_${stage}_failures`]?.count ?? 0,
      }));
      console.log(`Rampa de 45s por tramo: ${JSON.stringify(stages)}`);
      const requirements = ['RF8.2', 'RF8.3', 'RF8.4', 'RF8.5', 'RF8.7'].map((rf) => ({
        rf,
        requests: summary.metrics[`http_reqs{rf:${rf}}`]?.count ?? null,
        p95Ms: summary.metrics[`http_req_duration{rf:${rf}}`]?.['p(95)'] ?? null,
      }));
      console.log(`Rampa por RF: ${JSON.stringify(requirements)}`);
      const firstFailed = stages.find((stage) => stage.failures > 0);
      console.log(firstFailed
        ? `Primer tramo con check fallido: ${firstFailed.stage} (hasta ${firstFailed.targetVus} VU).`
        : `Sin checks fallidos hasta ${vus} VU; revisar tambien p95 y umbrales de k6.`);
    }
  }
  process.exitCode = code ?? 1;
});
