// Resumen propio: JSON completo en performance/results/ + texto breve por consola.
// Se escribe SIEMPRE, también cuando los thresholds fallan (se preserva el resultado fallido).
import { PROFILE, RUN_ID } from './config.js';
import { capacityPlan } from './capacity-plan.js';
import { capacityReport } from './capacity-report.js';

const RESULTS_DIR = __ENV.RESULTS_DIR || 'performance/results';

const fmt = (value) => (typeof value === 'number' ? value.toFixed(2) : String(value));

const line = (name, metric) => {
  if (metric === undefined) return null;
  const values = metric.values;
  if (metric.type === 'trend') {
    return `${name}: avg=${fmt(values.avg)} p50=${fmt(values.med)} p95=${fmt(values['p(95)'])} p99=${fmt(values['p(99)'])} max=${fmt(values.max)}`;
  }
  if (metric.type === 'rate') return `${name}: ${(values.rate * 100).toFixed(2)} %`;
  if (metric.type === 'counter') return `${name}: ${values.count} (${fmt(values.rate)}/s)`;
  return `${name}: ${JSON.stringify(values)}`;
};

export const buildSummary = (scenario) => (data) => {
  const metrics = data.metrics;
  const capacity = scenario === 'breakpoint' ? capacityReport(metrics, capacityPlan(__ENV)) : null;
  const thresholds = Object.entries(metrics)
    .filter(([, metric]) => metric.thresholds !== undefined)
    .flatMap(([name, metric]) =>
      Object.entries(metric.thresholds).map(
        ([rule, result]) => `${result.ok ? 'OK  ' : 'FAIL'} ${name} ${rule}`,
      ),
    );
  const interesting = Object.keys(metrics)
    .filter(
      (name) =>
        name.startsWith('http_req_duration{op:') ||
        name.startsWith('http_req_duration{stage:') ||
        name.startsWith('m9_') ||
        [
          'http_reqs',
          'http_req_failed',
          'checks',
          'iterations',
          'dropped_iterations',
          'vus_max',
        ].includes(name),
    )
    .sort();

  const text = [
    '',
    `=== M9 k6 · ${scenario} · RUN_ID=${RUN_ID} · perfil=${PROFILE} ===`,
    ...interesting.map((name) => line(name, metrics[name])).filter((item) => item !== null),
    '--- thresholds (iniciales, a calibrar) ---',
    ...thresholds,
    ...(capacity === null
      ? []
      : [
          '--- escalones: objetivo de solicitudes/s, p95 y errores ---',
          ...capacity.levels.map(
            (level) =>
              `${level.passed ? 'OK' : 'FAIL'} ${level.stage}: objetivo=${level.targetRps}/s muestras=${level.requests} p95=${fmt(level.p95Ms)}ms errores=${level.unexpectedErrorRate === null ? 'sin muestras' : fmt(level.unexpectedErrorRate * 100) + '%'}`,
          ),
          `Recuperación: ${capacity.recoveryPassed ? 'OK' : 'FAIL'} · iteraciones no iniciadas=${capacity.droppedIterations}`,
          capacity.interpretation,
        ]),
    '',
  ].join('\n');

  return {
    stdout: text,
    [`${RESULTS_DIR}/${scenario}-${RUN_ID}.json`]: JSON.stringify(
      {
        scenario,
        runId: RUN_ID,
        profile: PROFILE,
        generatedAt: new Date().toISOString(),
        metrics,
        ...(capacity === null ? {} : { capacity }),
      },
      null,
      2,
    ),
  };
};
