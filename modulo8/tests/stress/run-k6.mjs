#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'dotenv';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const moduleDir = path.resolve(scriptDir, '../..');
const mode = (process.argv[2] || 'http').toLowerCase();
const vus = Number(process.argv[3] || 1);
const iterations = Number(process.argv[4] || vus);
const modes = new Set(['http', 'qr', 'receipts', 'support', 'delivery']);
if (!modes.has(mode) || !Number.isInteger(vus) || vus < 1 || vus > 600
    || !Number.isInteger(iterations) || iterations < 1 || iterations > 600) {
  console.error('Uso: node tests/stress/run-k6.mjs <http|qr|receipts|support|delivery> [vus 1..600] [iteraciones 1..600].');
  process.exit(2);
}

const envPath = path.join(moduleDir, '.env');
const localEnv = existsSync(envPath) ? parse(readFileSync(envPath)) : {};
const get = (name) => process.env[name] || localEnv[name] || '';
const port = Number(get('M8_HOST_PORT') || 8000);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error('M8_HOST_PORT debe ser un puerto válido.');
  process.exit(2);
}

let targetUrl = get('TARGET_URL') || `http://host.docker.internal:${port}`;
let dockerNetwork = '';
if (vus > 1 && !get('TARGET_URL')) {
  const app = spawnSync('docker', ['compose', '--env-file', '.env', 'ps', '-q', 'm8-app'],
    { cwd: moduleDir, encoding: 'utf8' });
  if (app.status !== 0 || !app.stdout.trim()) {
    console.error('m8-app no esta iniciado en Compose. Ejecutar pnpm run ensure:stack.');
    process.exit(2);
  }
  const network = spawnSync('docker', ['inspect', '--format',
    '{{range $name, $network := .NetworkSettings.Networks}}{{println $name}}{{end}}', app.stdout.trim()],
  { cwd: moduleDir, encoding: 'utf8' });
  dockerNetwork = network.stdout.trim().split(/\r?\n/).find(Boolean) || '';
  if (network.status !== 0 || !/^[A-Za-z0-9_.-]+$/.test(dockerNetwork)) {
    console.error('No se pudo identificar la red Docker de m8-app.');
    process.exit(2);
  }
  targetUrl = 'http://m8-app:3000';
}
const parsedTarget = new URL(targetUrl);
if (['localhost', '127.0.0.1'].includes(parsedTarget.hostname)) {
  parsedTarget.hostname = 'host.docker.internal';
  targetUrl = parsedTarget.toString().replace(/\/$/, '');
}

const qrKey = get('QR_INTERNAL_API_KEY');
const jwtSecret = get('M1_JWT_SECRET');
if ((mode === 'http' || mode === 'qr') && (!qrKey || qrKey.startsWith('replace-with-'))) {
  console.error('Configurar QR_INTERNAL_API_KEY en modulo8/.env antes del smoke QR.');
  process.exit(2);
}
if ((mode === 'http' || mode === 'delivery') && (!jwtSecret || jwtSecret.startsWith('replace-with-'))) {
  console.error('Configurar M1_JWT_SECRET en modulo8/.env antes del smoke de dispositivos.');
  process.exit(2);
}

const childEnv = {
  ...process.env,
  TARGET_URL: targetUrl,
  QR_INTERNAL_API_KEY: qrKey,
  M1_JWT_SECRET: jwtSecret,
  SMOKE_MODE: mode,
  SMOKE_RUN_ID: randomUUID(),
  SMOKE_VERBOSE: vus === 1 ? 'true' : 'false',
};
const args = [
  'run', '--rm',
  ...(dockerNetwork ? ['--network', dockerNetwork] : ['--add-host', 'host.docker.internal:host-gateway']),
  '--volume', `${scriptDir}:/scripts:ro`,
  '-e', 'TARGET_URL',
  '-e', 'QR_INTERNAL_API_KEY',
  '-e', 'M1_JWT_SECRET',
  '-e', 'SMOKE_MODE',
  '-e', 'SMOKE_RUN_ID',
  '-e', 'SMOKE_VERBOSE',
  'grafana/k6:2.4.0', 'run', '--vus', String(vus), '--iterations', String(iterations), '/scripts/smoke-m8.js',
];

console.log(`Flujo HTTP de M8: ${mode}, ${vus} VU, ${iterations} iteraciones contra ${targetUrl}`);
const child = spawn('docker', args, { stdio: 'inherit', env: childEnv });
child.on('error', (error) => {
  console.error(`No se pudo iniciar Docker: ${error.message}`);
  process.exitCode = 1;
});
child.on('exit', (code) => {
  process.exitCode = code ?? 1;
});
