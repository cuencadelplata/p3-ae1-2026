import { describe, expect, it } from 'vitest';
import { capacityPlan, seconds, windowAt } from '../../performance/k6/lib/capacity-plan.js';
import { capacityReport } from '../../performance/k6/lib/capacity-report.js';

describe('plan de saturación k6', () => {
  it('sostiene cada tasa y mantiene tráfico durante la recuperación', () => {
    const plan = capacityPlan({ BREAKPOINT_RPS: '10,25', STEP_DURATION: '15s' });
    expect(
      plan.windows.filter((w) => w.stage.startsWith('hold-')).map((w) => w.end - w.start),
    ).toEqual([15, 15]);
    const recovery = plan.windows.at(-1)!;
    expect(recovery.stage).toBe('recovery');
    expect(recovery.target).toBe(5);
    expect(windowAt(plan, recovery.start).stage).toBe('recovery');
    expect(plan.maxVUs).toBeGreaterThanOrEqual(plan.preAllocatedVUs);
  });

  it.each([
    { BREAKPOINT_RPS: '10,0' },
    { BREAKPOINT_RPS: '10,5' },
    { BREAKPOINT_RPS: '10,no' },
    { BREAKPOINT_RPS: '10,10' },
    { PRE_ALLOCATED_VUS: '30', MAX_VUS: '10' },
    { STEP_DURATION: '0s' },
    { STEP_DURATION: 'no' },
    { BASELINE_RPS: '20', BREAKPOINT_RPS: '10,30' },
  ])('rechaza una configuración inválida antes de enviar carga: %j', (env) => {
    expect(() => capacityPlan(env)).toThrow();
  });

  it('interpreta unidades y asigna correctamente los límites entre fases', () => {
    expect(seconds('1.5m')).toBe(90);
    expect(seconds('500ms')).toBe(0.5);
    const plan = capacityPlan({ PROFILE: 'short', BREAKPOINT_RPS: '10' });
    expect(windowAt(plan, 9.99).stage).toBe('baseline');
    expect(windowAt(plan, 10).stage).toBe('ramp-1');
    expect(windowAt(plan, 13).stage).toBe('hold-1');
  });

  it('no presenta escalones vacíos o un escalón posterior al fallo como capacidad demostrada', () => {
    const plan = capacityPlan({ BREAKPOINT_RPS: '10,20,30' });
    const metrics = {};
    const add = (stage, latency, errors) => {
      metrics[`http_reqs{stage:${stage}}`] = { values: { count: 100 } };
      metrics[`http_req_duration{stage:${stage}}`] = { values: { 'p(95)': latency } };
      metrics[`m9_unexpected_errors{stage:${stage}}`] = { values: { rate: errors } };
      metrics[`checks{stage:${stage}}`] = { values: { rate: 1 } };
    };
    add('hold-1', 100, 0);
    add('hold-2', 900, 0.1);
    add('hold-3', 200, 0);
    metrics.dropped_iterations = { values: { count: 12 } };
    const report = capacityReport(metrics, plan);
    expect(report.highestPassingStageTargetRps).toBe(10);
    expect(report.recoveryPassed).toBe(false);
    expect(report.levels[0].passed).toBe(false); // baseline sin muestras
    expect(report.droppedIterations).toBe(12);
    expect(report.capacityConfirmed).toBe(false);
  });

  it('considera la degradación de tarifa aunque la respuesta HTTP sea exitosa', () => {
    const plan = capacityPlan({ BREAKPOINT_RPS: '10' });
    const report = capacityReport(
      {
        'http_reqs{stage:hold-1}': { values: { count: 10 } },
        'http_req_duration{stage:hold-1}': { values: { 'p(95)': 100 } },
        'm9_unexpected_errors{stage:hold-1}': { values: { rate: 0 } },
        'checks{stage:hold-1}': { values: { rate: 1 } },
        'm9_pricing_degraded{stage:hold-1}': { values: { rate: 0.5 } },
      },
      plan,
    );
    expect(report.highestPassingStageTargetRps).toBeNull();
  });
});
