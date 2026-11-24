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
  if (dashboard.apiVersion !== 'dashboard.grafana.app/v2' || dashboard.kind !== 'Dashboard') {
    errors.push(`${file}: se requiere el modelo V2 con pestañas nativas`);
    continue;
  }
  const uid = dashboard.metadata?.name;
  if (uid !== 'm9-ae4-general' || uids.has(uid))
    errors.push(`${file}: UID inválido/duplicado ${uid}`);
  uids.add(uid);
  const spec = dashboard.spec;
  const vars = spec.variables.map((item) => item.spec.name);
  for (const required of ['datasource', 'loki', 'tempo', 'env', 'service', 'k6_run']) {
    if (!vars.includes(required)) errors.push(`${file}: falta variable $${required}`);
  }
  const panelIds = new Set();
  for (const element of Object.values(spec.elements)) {
    const panel = element.spec;
    if (panelIds.has(panel.id)) errors.push(`${file}: ID de panel duplicado ${panel.id}`);
    panelIds.add(panel.id);
    for (const target of panel.data.spec.queries) {
      const query = target.spec.query;
      if (query.group === 'prometheus' && typeof query.spec.expr === 'string') {
        exprCount += 1;
        checkExpr(`${file} · ${panel.title}`, query.spec.expr);
      }
    }
  }
  if (spec.layout.kind !== 'TabsLayout') errors.push(`${file}: falta TabsLayout`);
  const tabs = spec.layout.spec.tabs ?? [];
  for (let rf = 1; rf <= 7; rf++) {
    const tab = tabs.find((item) => item.spec.title.startsWith(`RF-9.${rf} ·`));
    if (!tab) {
      errors.push(`${file}: falta pestaña RF-9.${rf}`);
      continue;
    }
    const sources = new Set(
      tab.spec.layout.spec.items.flatMap(
        (item) =>
          spec.elements[item.spec.element.name]?.spec.data.spec.queries.map(
            (query) => query.spec.query.group,
          ) ?? [],
      ),
    );
    for (const source of ['prometheus', 'loki', 'tempo']) {
      if (!sources.has(source)) errors.push(`RF-9.${rf}: falta bloque ${source}`);
    }
  }
  const referenced = new Set();
  for (const tab of tabs) {
    const occupied = [];
    for (const item of tab.spec.layout.spec.items) {
      const pos = item.spec;
      const name = pos.element.name;
      if (!spec.elements[name]) errors.push(`${file}: referencia inexistente ${name}`);
      if (referenced.has(name)) errors.push(`${file}: referencia duplicada ${name}`);
      referenced.add(name);
      if (
        ![pos.x, pos.y, pos.width, pos.height].every(Number.isInteger) ||
        pos.x < 0 ||
        pos.y < 0 ||
        pos.width <= 0 ||
        pos.height <= 0 ||
        pos.x + pos.width > 24
      ) {
        errors.push(`${file} · ${tab.spec.title}: posición de panel inválida`);
        continue;
      }
      for (const previous of occupied) {
        if (
          pos.x < previous.x + previous.width &&
          previous.x < pos.x + pos.width &&
          pos.y < previous.y + previous.height &&
          previous.y < pos.y + pos.height
        ) {
          errors.push(`${file} · ${tab.spec.title}: paneles superpuestos`);
        }
      }
      occupied.push(pos);
    }
  }
  for (const name of Object.keys(spec.elements)) {
    if (!referenced.has(name)) errors.push(`${file}: panel sin pestaña ${name}`);
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
