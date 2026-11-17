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
    if (!known.has(token)) errors.push(`${where}: métrica desconocida "${token}"`);
  }
};

const dashDir = path.join(root, 'observability', 'grafana', 'dashboards');
const uids = new Set();
let exprCount = 0;
for (const file of readdirSync(dashDir).filter((name) => name.endsWith('.json'))) {
  const dashboard = JSON.parse(readFileSync(path.join(dashDir, file), 'utf8'));
  if (uids.has(dashboard.uid)) errors.push(`${file}: UID duplicado ${dashboard.uid}`);
  uids.add(dashboard.uid);
  const vars = dashboard.templating.list.map((item) => item.name);
  for (const required of ['datasource', 'loki', 'tempo', 'env', 'service']) {
    if (!vars.includes(required)) errors.push(`${file}: falta variable $${required}`);
  }
  for (const panel of dashboard.panels) {
    for (const target of panel.targets ?? []) {
      if (target.datasource?.type === 'prometheus' && typeof target.expr === 'string') {
        exprCount += 1;
        checkExpr(`${file} · ${panel.title}`, target.expr);
      }
    }
  }
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
