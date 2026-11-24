// Configuración común de los escenarios k6 de M9 (solo APIs compatibles con k6).
import { CLIENT_POOL_SIZE, clientIdFor } from './ids.js';

const env = (name, fallback) =>
  __ENV[name] === undefined || __ENV[name] === '' ? fallback : __ENV[name];

export const num = (name, fallback) => {
  const value = Number(env(name, fallback));
  return Number.isFinite(value) ? value : fallback;
};

/** Desde el host: http://localhost:3000. Dentro de la red Compose: http://m9-reservas:3000. */
export const BASE_URL = env('BASE_URL', 'http://localhost:3000').replace(/\/+$/, '');
export const RUN_ID = env('RUN_ID', `run-${Date.now()}`);
/** `short` reduce duraciones para ahorrar cuota de Grafana Cloud k6. */
export const PROFILE = env('PROFILE', 'standard');
export const SCENARIO = env('SCENARIO_NAME', 'manual');

export const duration = (standard, short) =>
  env('DURATION', PROFILE === 'short' ? short : standard);

const VEHICULOS = ['AUTO', 'MOTO'];

/** Fecha relativa al reloj de ejecución; por defecto 2 días hacia adelante (CRUD sin activar). */
export const futureIso = (minutes = 2 * 24 * 60) =>
  new Date(Date.now() + minutes * 60_000).toISOString();

export const futureIsoSeconds = (seconds) => new Date(Date.now() + seconds * 1000).toISOString();

export const FIXED_CLIENT_ID = env('CLIENT_ID', '');

/** Datos ficticios: direcciones genéricas y cliente derivado del RUN_ID (o fijo en integración). */
export const reservaPayload = (index, fechaHoraProgramada = futureIso()) => ({
  clienteId: FIXED_CLIENT_ID || clientIdFor(RUN_ID, index % CLIENT_POOL_SIZE),
  origen: `Origen k6 ${index % 97}`,
  destino: `Destino k6 ${(index % 89) + 1}`,
  vehiculo: VEHICULOS[index % 2],
  fechaHoraProgramada,
});

/** Umbrales INICIALES de referencia (hipótesis para calibrar, no SLA ni exigencia docente). */
export const BASE_THRESHOLDS = {
  checks: ['rate>0.99'],
  m9_unexpected_errors: ['rate<0.01'],
  'http_req_duration{op:create}': ['p(95)<500'],
  'http_req_duration{op:get}': ['p(95)<500'],
  'http_req_duration{op:update}': ['p(95)<500'],
  'http_req_duration{op:cancel}': ['p(95)<500'],
  'http_req_duration{op:list}': ['p(95)<800'],
};

export const testTags = (scenario) => ({ run_id: RUN_ID, scenario, profile: PROFILE });

/** Opciones de Grafana Cloud k6 (solo se usan con `k6 cloud run --local-execution`). */
export const cloudOptions = (name) => ({
  name: `M9 Reservas - ${name}`,
  ...(env('K6_CLOUD_PROJECT_ID', '') === ''
    ? {}
    : { projectID: Number(env('K6_CLOUD_PROJECT_ID', '0')) }),
});
