#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'dotenv';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const moduleDir = path.resolve(scriptDir, '../..');
const resultsDir = path.join(scriptDir, 'results');
const envPath = path.join(moduleDir, '.env');
const localEnv = existsSync(envPath) ? parse(readFileSync(envPath)) : {};
const get = (name) => process.env[name] || localEnv[name] || '';
const mode = process.argv[2] || get('CAPACITY_MODE') || 'support';
const modeNames = {
  support: 'RF8.5 GET /tickets (solo lectura)',
  qr: 'RF8.2 generacion y validacion QR',
  receipts: 'RF8.3 descarga PDF (comprobante preparado)',
  resend: 'RF8.4 consulta de referencia de reenvio',
  delivery: 'RF8.7 consulta de tokens (sin PUSH)',
  mixed: 'M8 HTTP mixto (QR, PDF, reenvio, soporte y tokens)',
};
const levels = (get('CAPACITY_LEVELS') || (mode === 'support' ? '25,50,100,200,400,600' : '50,100,200,400,600'))
  .split(',').map((value) => Number(value.trim()));
const seconds = Number(process.argv[3] || get('CAPACITY_SECONDS') || 10);
const maxFailureRate = Number(get('CAPACITY_MAX_FAILURE_RATE') || 0);
const port = Number(get('M8_HOST_PORT') || 3000);
if (!(mode in modeNames)
    || levels.length === 0 || levels.length > 10 || levels.some((n) => !Number.isInteger(n) || n < 1 || n > 1200)
    || !Number.isInteger(seconds) || seconds < 5 || seconds > 60
    || !Number.isFinite(maxFailureRate) || maxFailureRate < 0 || maxFailureRate > 0.1
    || !Number.isInteger(port) || port < 1 || port > 65535) {
  console.error('CAPACITY_LEVELS: 1..1200 (maximo 10 niveles); CAPACITY_SECONDS: 5..60; M8_HOST_PORT: puerto valido.');
  process.exit(2);
}

const runId = new Date().toISOString().replace(/[:.]/g, '-');
const targetUrl = `http://127.0.0.1:${port}`;
mkdirSync(resultsDir, { recursive: true });

async function ready() {
  try {
    const response = await fetch(`${targetUrl}/health/ready`, { signal: AbortSignal.timeout(3000) });
    const body = await response.json();
    return { httpStatus: response.status, status: body.status ?? 'unknown' };
  } catch (error) {
    return { httpStatus: 0, status: 'unreachable', detail: error.cause?.code || error.name };
  }
}

async function processMetrics() {
  try {
    const response = await fetch(`${targetUrl}/metrics`, { signal: AbortSignal.timeout(3000) });
    if (!response.ok) return null;
    const body = await response.text();
    const value = (name) => {
      const line = body.split('\n').find((item) => item.startsWith(`${name}{`));
      return line ? Number(line.trim().split(/\s+/).at(-1)) : null;
    };
    const rss = value('nodejs_process_resident_memory_bytes');
    const database = value('m8_storage_size_bytes');
    return {
      rssMB: rss === null ? null : rss / 1e6,
      cpuSeconds: value('nodejs_process_cpu_seconds_total'),
      databaseMB: database === null ? null : database / 1e6,
    };
  } catch {
    return null;
  }
}

async function execute(level, resultName) {
  const childEnv = {
    ...process.env,
    TARGET_URL: 'http://m8-app:3000',
    LOAD_PATTERN: 'constant',
    LOAD_VUS: String(level),
    LOAD_DURATION_SECONDS: String(seconds),
    LOAD_RESULT_NAME: resultName,
  };
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(scriptDir, 'run-load.mjs'), mode], {
      cwd: moduleDir, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    for (const stream of [child.stdout, child.stderr]) {
      stream.on('data', (chunk) => { output = `${output}${chunk}`.slice(-12000); });
    }
    child.on('error', (error) => resolve({ code: 1, output: error.message }));
    child.on('close', (code) => resolve({ code: code ?? 1, output }));
  });
}

const report = {
  scenario: modeNames[mode],
  target: targetUrl,
  startedAt: new Date().toISOString(),
  levelSeconds: seconds,
  criteria: { maxHttpFailureRate: maxFailureRate, maxP95Ms: 1000, readiness: 'ok' },
  levels: [],
};
const before = await ready();
if (before.httpStatus !== 200 || before.status !== 'ok') {
  console.error(`M8 no esta listo para la prueba: HTTP ${before.httpStatus}, estado ${before.status}.`);
  process.exit(1);
}

console.log(`Capacidad local ${mode}, ${seconds}s por nivel: ${levels.join(' -> ')} VU`);
for (const level of levels) {
  const resultName = `capacity-${mode}-${runId}-${level}vu.json`;
  const startedAt = new Date().toISOString();
  console.log(`Nivel ${level} VU iniciado: ${startedAt}`);
  const beforeMetrics = await processMetrics();
  const startMs = Date.now();
  const execution = await execute(level, resultName);
  const elapsedSeconds = (Date.now() - startMs) / 1000;
  const summaryPath = path.join(resultsDir, resultName);
  let metrics = {};
  if (existsSync(summaryPath)) {
    const summary = JSON.parse(readFileSync(summaryPath, 'utf8'));
    metrics = {
      requests: summary.metrics.http_reqs?.count ?? 0,
      rps: summary.metrics.http_reqs?.rate ?? 0,
      p95Ms: summary.metrics.http_req_duration?.['p(95)'] ?? null,
      httpFailureRate: summary.metrics.http_req_failed?.value ?? null,
      checkRate: summary.metrics.checks?.value ?? null,
    };
  }
  const health = await ready();
  const afterMetrics = await processMetrics();
  const resources = {
    rssMB: afterMetrics?.rssMB ?? null,
    databaseMB: afterMetrics?.databaseMB ?? null,
    cpuPercentOneCore: beforeMetrics?.cpuSeconds != null && afterMetrics?.cpuSeconds != null
      ? ((afterMetrics.cpuSeconds - beforeMetrics.cpuSeconds) / elapsedSeconds) * 100 : null,
  };
  const failed = execution.code !== 0 || !existsSync(summaryPath)
    || metrics.httpFailureRate === null || metrics.httpFailureRate > maxFailureRate
    || metrics.p95Ms === null || metrics.p95Ms >= 1000
    || health.httpStatus !== 200 || health.status !== 'ok';
  report.levels.push({ vus: level, activeSeconds: seconds, elapsedSeconds,
    startedAt, finishedAt: new Date().toISOString(),
    ...metrics, resources, health, passed: !failed, summary: path.relative(moduleDir, summaryPath) });
  console.log(`${level} VU: ${metrics.requests ?? 0} pedidos, ${Number(metrics.rps ?? 0).toFixed(1)} req/s, `
    + `p95 ${metrics.p95Ms ?? 'n/d'} ms, errores ${metrics.httpFailureRate ?? 'n/d'}, `
    + `RSS ${resources.rssMB?.toFixed(1) ?? 'n/d'} MB, CPU ${resources.cpuPercentOneCore?.toFixed(1) ?? 'n/d'} %, salud ${health.status}`);
  if (failed) {
    console.log('Primer nivel que incumple los criterios: ', level);
    console.log(execution.output.slice(-2500));
    break;
  }
}
report.finishedAt = new Date().toISOString();
report.firstFailedVus = report.levels.find((item) => !item.passed)?.vus ?? null;
report.highestPassedVus = [...report.levels].reverse().find((item) => item.passed)?.vus ?? null;
const reportPath = path.join(resultsDir, `capacity-${mode}-${runId}-report.json`);
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(`Informe local: ${path.relative(moduleDir, reportPath)}`);
if (report.firstFailedVus === null) console.log('Sin fallo hasta el maximo probado; esto no garantiza capacidad fuera de este escenario.');
else console.log(`Ultimo nivel aprobado: ${report.highestPassedVus ?? 'ninguno'} VU.`);
process.exitCode = report.firstFailedVus === null ? 0 : 1;
