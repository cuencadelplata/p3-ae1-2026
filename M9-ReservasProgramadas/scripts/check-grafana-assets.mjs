/**
 * Validación local de dashboards y alertas (sin Grafana):
 *   - JSON válido, UID únicos, variables de datasource/entorno/servicio presentes.
 *   - Cada métrica usada en PromQL existe en el catálogo real de src/observability/metrics.ts
 *     (traducido a nombres Prometheus) o en la instrumentación de runtime registrada.
 *   - Paréntesis/llaves balanceados en cada expresión.
 * Uso: npm run obs:dashboards:check
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const source = readFileSync(path.join(root, 'src', 'observability', 'metrics.ts'), 'utf8');

const SUFFIX = { s: '_seconds', By: '_bytes' };
const prom = (name) => name.replaceAll('.', '_');
const known = new Set();
const addHistogram = (base) => ['_bucket', '_sum', '_count'].forEach((s) => known.add(base + s));

for (const match of source.matchAll(/histogram\(\s*'([a-z0-9._]+)'/g)) {
  addHistogram(`${prom(match[1])}_seconds`);
}
for (const match of source.matchAll(/counter\(\s*'([a-z0-9._]+)'/g))
  known.add(`${prom(match[1])}_total`);
for (const match of source.matchAll(
  /gauge\(\s*'([a-z0-9._]+)',\s*'(?:[^'\\]|\\.)*',\s*'([^']*)'/g,
)) {
  known.add(prom(match[1]) + (SUFFIX[match[2]] ?? ''));
}
// Instrumentos creados directamente con el meter.
known.add('http_server_active_requests');
known.add('process_cpu_time_seconds_total');
known.add('process_memory_usage_bytes');
// @opentelemetry/instrumentation-runtime-node (verificado con scripts/verify-otlp-export.mjs).
known.add('v8js_memory_heap_used_bytes');
known.add('nodejs_eventloop_utilization_ratio');
addHistogram('v8js_gc_duration_seconds');

const errors = [];
const usedMetrics = new Set();
const metricToken =
  /\b(m9_[a-z0-9_]+|http_server_[a-z_]+|process_[a-z_]+|v8js_[a-z_]+|nodejs_[a-z_]+)\b/g;
const balanced = (expr) => {
  const stack = [];
  const pairs = { ')': '(', '}': '{', ']': '[' };
  for (const char of expr.replace(/"(?:[^"\\]|\\.)*"/g, '')) {
    if ('({['.includes(char)) stack.push(char);
    else if (pairs[char] !== undefined && stack.pop() !== pairs[char]) return false;
  }
  return stack.length === 0;
};
const checkExpr = (where, expr) => {
  if (!balanced(expr)) errors.push(`${where}: paréntesis/llaves desbalanceados`);
  // Etiquetas (selectores {…} y cláusulas by/without (…)) no son nombres de métricas.
  const metricsOnly = expr.replace(/\{[^}]*\}/g, '').replace(/\b(by|without)\s*\([^)]*\)/g, '');
  for (const [token] of metricsOnly.matchAll(metricToken)) {
    usedMetrics.add(token);
    if (!known.has(token)) errors.push(`${where}: métrica desconocida "${token}"`);
  }
};

const dashDir = path.join(root, 'observability', 'grafana', 'dashboards');
const uids = new Set();
let exprCount = 0;
const dashboardFiles = readdirSync(dashDir).filter((name) => name.endsWith('.json'));
if (dashboardFiles.length !== 1 || dashboardFiles[0] !== 'm9-observabilidad.json') {
  errors.push('Se espera un único archivo de dashboard: m9-observabilidad.json');
}
for (const file of dashboardFiles) {
  const dashboard = JSON.parse(readFileSync(path.join(dashDir, file), 'utf8'));
  if (uids.has(dashboard.uid)) errors.push(`${file}: UID duplicado ${dashboard.uid}`);
  uids.add(dashboard.uid);
  const vars = dashboard.templating.list.map((item) => item.name);
  for (const required of ['datasource', 'loki', 'tempo', 'env', 'service', 'k6_run']) {
    if (!vars.includes(required)) errors.push(`${file}: falta variable $${required}`);
  }
  const panelIds = new Set();
  const occupied = [];
  for (const panel of dashboard.panels) {
    if (panelIds.has(panel.id)) errors.push(`${file}: ID de panel duplicado ${panel.id}`);
    panelIds.add(panel.id);
    const pos = panel.gridPos;
    if (
      !pos ||
      ![pos.x, pos.y, pos.w, pos.h].every(Number.isInteger) ||
      pos.x < 0 ||
      pos.y < 0 ||
      pos.w <= 0 ||
      pos.h <= 0 ||
      pos.x + pos.w > 24
    ) {
      errors.push(`${file} · ${panel.title}: posición de panel inválida`);
    } else {
      for (const previous of occupied) {
        const other = previous.gridPos;
        if (
          pos.x < other.x + other.w &&
          other.x < pos.x + pos.w &&
          pos.y < other.y + other.h &&
          other.y < pos.y + pos.h
        ) {
          errors.push(`${file}: ${panel.title} se superpone con ${previous.title}`);
        }
      }
      occupied.push(panel);
    }
    for (const target of panel.targets ?? []) {
      if (target.datasource?.type === 'prometheus' && typeof target.expr === 'string') {
        exprCount += 1;
        checkExpr(`${file} · ${panel.title}`, target.expr);
      }
    }
  }
}

// Un histograma puede visualizarse por buckets o count/sum; no hace falta
// graficar cada serie derivada, pero sí cubrir cada instrumento implementado.
const family = (name) => name.replace(/_(bucket|sum|count)$/, '');
const covered = new Set([...usedMetrics].map(family));
for (const metric of new Set([...known].map(family))) {
  if (!covered.has(metric)) errors.push(`El dashboard no cubre la métrica ${metric}`);
}

const alerts = readFileSync(
  path.join(root, 'observability', 'grafana', 'alerts', 'm9-alertas.rules.yaml'),
  'utf8',
);
const alertExprs = [...alerts.matchAll(/expr:\s*(\|\n((?:\s{10,}.*\n?)+)|(.+))/g)].map((m) =>
  (m[2] ?? m[3]).trim(),
);
alertExprs.forEach((expr, index) => checkExpr(`alerta #${index + 1}`, expr));

console.log(
  `Catálogo: ${known.size} series · dashboards: ${uids.size} (${exprCount} consultas PromQL) · alertas: ${alertExprs.length}`,
);
if (errors.length > 0) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log('OK: todas las consultas usan métricas implementadas.');
