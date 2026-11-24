// Funciones puras: también se verifican con Vitest, sin necesitar el runtime k6.
export const positiveInt = (value, fallback, name) => {
  const number = Number(value === undefined || value === '' ? fallback : value);
  if (!Number.isSafeInteger(number) || number < 1)
    throw new Error(`${name}: entero positivo requerido`);
  return number;
};

export const seconds = (value) => {
  const match = /^(\d+(?:\.\d+)?)(ms|s|m|h)$/.exec(String(value));
  if (!match) throw new Error(`Duración inválida: ${value}; usar ms, s, m o h`);
  const result = Number(match[1]) * { ms: 0.001, s: 1, m: 60, h: 3600 }[match[2]];
  if (result <= 0) throw new Error('La duración debe ser mayor que cero');
  return result;
};

export const capacityPlan = (env = {}) => {
  const short = env.PROFILE === 'short';
  const rates = String(env.BREAKPOINT_RPS || '10,25,50,100,200,400')
    .split(',')
    .map((value) => positiveInt(value.trim(), undefined, 'BREAKPOINT_RPS'));
  if (rates.some((rate, i) => i > 0 && rate <= rates[i - 1]))
    throw new Error('BREAKPOINT_RPS: los escalones deben ser crecientes');
  const baseline = positiveInt(env.BASELINE_RPS, 5, 'BASELINE_RPS');
  if (baseline > rates[0]) throw new Error('BASELINE_RPS no puede superar el primer escalón');
  const preAllocatedVUs = positiveInt(env.PRE_ALLOCATED_VUS, 20, 'PRE_ALLOCATED_VUS');
  const maxVUs = positiveInt(env.MAX_VUS, 200, 'MAX_VUS');
  if (preAllocatedVUs > maxVUs) throw new Error('PRE_ALLOCATED_VUS no puede superar MAX_VUS');
  const stages = [];
  const windows = [];
  let elapsed = 0;
  const add = (stage, duration, target) => {
    const end = elapsed + seconds(duration);
    windows.push({ stage, target, start: elapsed, end });
    stages.push({ duration, target });
    elapsed = end;
  };
  add('baseline', env.BASELINE_DURATION || (short ? '10s' : '30s'), baseline);
  rates.forEach((rate, i) => {
    add(`ramp-${i + 1}`, env.RAMP_DURATION || (short ? '3s' : '10s'), rate);
    add(`hold-${i + 1}`, env.STEP_DURATION || (short ? '10s' : '45s'), rate);
  });
  add('recovery-ramp', env.RAMP_DURATION || (short ? '3s' : '10s'), baseline);
  add('recovery', env.RECOVERY_DURATION || (short ? '20s' : '1m'), baseline);
  return { rates, baseline, stages, windows, preAllocatedVUs, maxVUs };
};

export const windowAt = (plan, elapsedSeconds) =>
  plan.windows.find((window) => elapsedSeconds >= window.start && elapsedSeconds < window.end) ||
  plan.windows[plan.windows.length - 1];
