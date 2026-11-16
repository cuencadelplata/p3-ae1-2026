#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'dotenv';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const moduleDir = path.resolve(scriptDir, '../..');
const mode = (process.argv[2] || 'http').toLowerCase();
const modes = new Set(['http', 'qr', 'receipts', 'support', 'delivery']);
if (!modes.has(mode)) {
  console.error(`Modo desconocido: ${mode}. Usar http, qr, receipts, support o delivery.`);
  process.exit(2);
}

const envPath = path.join(moduleDir, '.env');
const localEnv = existsSync(envPath) ? parse(readFileSync(envPath)) : {};
const get = (name) => process.env[name] || localEnv[name] || '';
const port = Number(get('M8_HOST_PORT') || 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error('M8_HOST_PORT debe ser un puerto válido.');
  process.exit(2);
}

let targetUrl = get('TARGET_URL') || `http://host.docker.internal:${port}`;
const parsedTarget = new URL(targetUrl);
if (['localhost', '127.0.0.1'].includes(parsedTarget.hostname)) {
  parsedTarget.hostname = 'host.docker.internal';
  targetUrl = parsedTarget.toString().replace(/\/$/, '');
}

const qrKey = get('QR_INTERNAL_API_KEY');
const jwtSecret = get('M1_JWT_SECRET');
if ((mode === 'http' || mode === 'qr') && (!qrKey || qrKey.startsWith('replace-with-'))) {
  console.error('Configurar QR_INTERNAL_API_KEY en modulo-8/.env antes del smoke QR.');
  process.exit(2);
}
if ((mode === 'http' || mode === 'delivery') && (!jwtSecret || jwtSecret.startsWith('replace-with-'))) {
  console.error('Configurar M1_JWT_SECRET en modulo-8/.env antes del smoke de dispositivos.');
  process.exit(2);
}

const childEnv = {
  ...process.env,
  TARGET_URL: targetUrl,
  QR_INTERNAL_API_KEY: qrKey,
  M1_JWT_SECRET: jwtSecret,
  QR_OPERATION_ID: randomUUID(),
  QR_SECOND_OPERATION_ID: randomUUID(),
  SMOKE_MODE: mode,
};
const args = [
  'run', '--rm',
  '--add-host', 'host.docker.internal:host-gateway',
  '--volume', `${scriptDir}:/scripts:ro`,
  '-e', 'TARGET_URL',
  '-e', 'QR_INTERNAL_API_KEY',
  '-e', 'M1_JWT_SECRET',
  '-e', 'QR_OPERATION_ID',
  '-e', 'QR_SECOND_OPERATION_ID',
  '-e', 'SMOKE_MODE',
  'grafana/k6:2.4.0', 'run', '/scripts/smoke-m8.js',
];

console.log(`Smoke HTTP de M8: ${mode} contra ${targetUrl}`);
const child = spawn('docker', args, { stdio: 'inherit', env: childEnv });
child.on('error', (error) => {
  console.error(`No se pudo iniciar Docker: ${error.message}`);
  process.exitCode = 1;
});
child.on('exit', (code) => {
  process.exitCode = code ?? 1;
});
