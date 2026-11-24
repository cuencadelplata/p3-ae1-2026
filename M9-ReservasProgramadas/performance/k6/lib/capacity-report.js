// Los objetivos de llegada no son capacidad demostrada: puede haber iteraciones descartadas.
export const capacityReport = (metrics, plan) => {
  const levels = plan.windows
    .filter(({ stage }) => !stage.includes('ramp'))
    .map((window) => {
      const suffix = `{stage:${window.stage}}`;
      const requests = metrics[`http_reqs${suffix}`]?.values?.count ?? 0;
      const p95 = metrics[`http_req_duration${suffix}`]?.values?.['p(95)'];
      const errors = metrics[`m9_unexpected_errors${suffix}`]?.values?.rate;
      const contractChecks = metrics[`checks${suffix}`]?.values?.rate;
      const degraded = metrics[`m9_pricing_degraded${suffix}`]?.values?.rate;
      const sampled =
        requests > 0 &&
        Number.isFinite(p95) &&
        Number.isFinite(errors) &&
        Number.isFinite(contractChecks);
      return {
        stage: window.stage,
        targetRps: window.target,
        requests,
        p95Ms: p95 ?? null,
        unexpectedErrorRate: errors ?? null,
        contractChecksRate: contractChecks ?? null,
        pricingDegradedRate: degraded ?? null,
        passed:
          sampled &&
          p95 < 800 &&
          errors < 0.01 &&
          contractChecks > 0.99 &&
          (degraded === undefined || degraded < 0.01),
      };
    });
  const droppedIterations = metrics.dropped_iterations?.values?.count ?? 0;
  const holds = levels.filter(({ stage }) => stage.startsWith('hold-'));
  let highestPassingStageTargetRps = null;
  for (const level of holds) {
    if (!level.passed) break;
    highestPassingStageTargetRps = level.targetRps;
  }
  return {
    levels,
    droppedIterations,
    highestPassingStageTargetRps,
    recoveryPassed: levels.find(({ stage }) => stage === 'recovery')?.passed ?? false,
    capacityConfirmed: false,
    interpretation:
      droppedIterations > 0
        ? 'Hubo iteraciones no iniciadas: revisar VUs, generador y tiempos del servicio antes de atribuir el limite a M9.'
        : 'Escalones observados bajo estos umbrales y este equipo; no constituyen un maximo absoluto ni un SLA.',
  };
};
