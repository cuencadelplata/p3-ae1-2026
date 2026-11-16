#!/usr/bin/env node
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const smokeMode = process.argv[2] || 'all';
const targetUrl = process.env.TARGET_URL || 'http://localhost:3000';
const jwtSecret = process.env.M1_JWT_SECRET || 'local-dev-m1-secret-not-for-production';

console.log(`[Runner K6] Ejecutando modo '${smokeMode}' contra '${targetUrl}'...`);

const scriptHostDir = __dirname.replace(/\\/g, '/');
const dockerArgs = [
  'run',
  '--rm',
  '-i',
  '--network',
  'host',
  '-v',
  `${scriptHostDir}:/scripts`,
  '-e',
  `TARGET_URL=${targetUrl}`,
  '-e',
  `M1_JWT_SECRET=${jwtSecret}`,
  '-e',
  `SMOKE_MODE=${smokeMode}`,
  'grafana/k6:latest',
  'run',
  '/scripts/smoke-m8.js',
];

const child = spawn('docker', dockerArgs, { stdio: 'inherit' });

child.on('exit', (code) => {
  process.exit(code ?? 0);
});
