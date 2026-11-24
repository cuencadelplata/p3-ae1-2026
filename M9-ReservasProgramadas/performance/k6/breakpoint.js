// Búsqueda de saturación con carga abierta. No aborta al fallar un SLA:
// conserva escalones, sobrecarga y recuperación; el FAIL de thresholds se propaga.
import exec from 'k6/execution';
import { fail } from 'k6';

import { crear, obtener } from './lib/api.js';
import { capacityPlan, windowAt } from './lib/capacity-plan.js';
import { cloudOptions, reservaPayload, testTags } from './lib/config.js';
import { steadyWorkload } from './lib/steady-workload.js';
import { buildSummary } from './lib/summary.js';

const plan = capacityPlan(__ENV);
const thresholds = {
  checks: ['rate>0.99'],
  m9_unexpected_errors: ['rate<0.01'],
  m9_pricing_degraded: ['rate<0.01'],
  dropped_iterations: ['count==0'],
};
for (const window of plan.windows.filter(({ stage }) => !stage.includes('ramp'))) {
  thresholds[`http_req_duration{stage:${window.stage}}`] = ['p(95)<800'];
  thresholds[`m9_unexpected_errors{stage:${window.stage}}`] = ['rate<0.01'];
  thresholds[`checks{stage:${window.stage}}`] = ['rate>0.99'];
  thresholds[`m9_pricing_degraded{stage:${window.stage}}`] = ['rate<0.01'];
  thresholds[`http_reqs{stage:${window.stage}}`] = ['count>0'];
}

export const options = {
  scenarios: {
    breakpoint: {
      executor: 'ramping-arrival-rate',
      startRate: plan.baseline,
      timeUnit: '1s',
      preAllocatedVUs: plan.preAllocatedVUs,
      maxVUs: plan.maxVUs,
      stages: plan.stages,
      gracefulStop: '15s',
    },
  },
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(95)', 'p(99)'],
  thresholds,
  tags: testTags('breakpoint'),
  cloud: cloudOptions('límite y recuperación'),
};

export function setup() {
  const seed = crear(reservaPayload(720_000));
  if (seed === null || obtener(seed.id) === null) fail('M9 no supera la verificación previa');
}

export default function () {
  const window = windowAt(plan, (Date.now() - exec.scenario.startTime) / 1000);
  exec.vu.metrics.tags.stage = window.stage;
  exec.vu.metrics.tags.target_rps = String(window.target);
  steadyWorkload(); // Sin sleep: el ejecutor controla la tasa de llegada.
}

export const handleSummary = buildSummary('breakpoint');
