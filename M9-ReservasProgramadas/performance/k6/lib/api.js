// Cliente HTTP de M9 para k6. Nombres de request estables (`name`) y etiqueta `op` para que
// Grafana Cloud k6 agrupe por operación y nunca por URL con UUID.
import { check } from 'k6';
import http from 'k6/http';
import { Counter, Rate } from 'k6/metrics';

import { BASE_URL, RUN_ID } from './config.js';

export const unexpectedErrors = new Rate('m9_unexpected_errors');
export const expectedConflicts = new Counter('m9_expected_conflicts');
export const idempotencyChecks = new Counter('m9_idempotency_checks');
export const expectedRejections = new Counter('m9_expected_rejections');
export const pricingDegraded = new Rate('m9_pricing_degraded');
export const transportErrors = new Counter('m9_transport_errors');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ESTADOS = ['PROGRAMADA', 'ACTIVANDO', 'ACTIVADA', 'CANCELADA', 'FALLIDA'];

let sequence = 0;
const headers = () => {
  sequence += 1;
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${__ENV.M9_AUTH_TOKEN || ''}`,
    // Correlación k6 → logs de M9 (caracteres válidos para el middleware).
    'x-correlation-id':
      `${RUN_ID}-${typeof __VU === 'undefined' ? 0 : __VU}-${typeof __ITER === 'undefined' ? 'setup' : __ITER}-${sequence}`.slice(
        0,
        128,
      ),
  };
};

const params = (name, op, extra = {}) => ({
  headers: headers(),
  timeout: __ENV.REQUEST_TIMEOUT || '10s',
  tags: { name, op, ...extra.tags },
  ...(extra.expected === undefined
    ? {}
    : { responseCallback: http.expectedStatuses(...extra.expected) }),
});

export const parse = (response) => {
  try {
    return response.json();
  } catch {
    return null;
  }
};

export const isReserva = (body) =>
  body !== null &&
  typeof body === 'object' &&
  UUID.test(String(body.id)) &&
  ESTADOS.includes(body.estado) &&
  typeof body.fechaHoraProgramada === 'string';

/** Registra si el status no es el esperado (los 409 esperados se cuentan aparte). */
const track = (response, okStatuses) => {
  const ok = okStatuses.includes(response.status);
  if (response.status === 0) transportErrors.add(1);
  unexpectedErrors.add(!ok);
  return ok;
};

/** Lotes realmente paralelos. Cada entrada opera sobre una reserva independiente.
 * Un lote no mezcla pasos dependientes: el escenario espera la creación antes del GET.
 */
export const batchReservas = (requests, extraTags = {}) => {
  if (requests.length === 0) return [];
  const operations = { POST: 'create', GET: 'get', PATCH: 'update', DELETE: 'cancel' };
  const descriptors = requests.map(({ method, id, body }) => {
    const op = method === 'GET' && id === undefined ? 'list' : operations[method];
    if (op === undefined) throw new Error(`Método no soportado por batchReservas: ${method}`);
    const suffix = id === undefined ? '' : `/${id}`;
    return {
      method,
      url: `${BASE_URL}/reservas${suffix}`,
      body: body === undefined ? null : JSON.stringify(body),
      params: params(`${method} /reservas${id === undefined ? '' : '/:id'}`, op, {
        tags: extraTags,
      }),
    };
  });
  return http.batch(descriptors).map((response, index) => {
    const request = requests[index];
    const op = descriptors[index].params.tags.op;
    const body = parse(response);
    const statusOk = response.status === (request.method === 'POST' ? 201 : 200);
    const schemaOk = op === 'list' ? Array.isArray(body?.reservas) : isReserva(body);
    const identityOk = request.id === undefined || body?.id === request.id;
    const stateOk =
      request.method === 'POST'
        ? body?.estado === 'PROGRAMADA'
        : request.method !== 'DELETE' || body?.estado === 'CANCELADA';
    const changesOk =
      request.method !== 'PATCH' ||
      Object.entries(request.body).every(([key, value]) =>
        key === 'fechaHoraProgramada'
          ? Date.parse(body?.[key]) === Date.parse(value)
          : body?.[key] === value,
      );
    const ok = statusOk && schemaOk && identityOk && stateOk && changesOk;
    check(response, { [`batch ${op}: contrato y resultado correctos`]: () => ok });
    unexpectedErrors.add(!ok);
    if (response.status === 0) transportErrors.add(1);
    if (
      statusOk &&
      (request.method === 'POST' ||
        (request.method === 'PATCH' && request.body.vehiculo !== undefined))
    )
      pricingDegraded.add(body?.tarifaEstimada == null);
    return ok ? body : null;
  });
};

export const crear = (payload, extraTags = {}) => {
  const response = http.post(
    `${BASE_URL}/reservas`,
    JSON.stringify(payload),
    params('POST /reservas', 'create', { tags: extraTags }),
  );
  track(response, [201]);
  const body = parse(response);
  check(response, {
    'crear: 201': (r) => r.status === 201,
    'crear: esquema Reserva': () => isReserva(body),
    'crear: estado PROGRAMADA': () => body?.estado === 'PROGRAMADA',
  });
  if (response.status === 201) pricingDegraded.add(body?.tarifaEstimada === null);
  return response.status === 201 ? body : null;
};

export const obtener = (id, name = 'GET /reservas/:id', op = 'get') => {
  const response = http.get(`${BASE_URL}/reservas/${id}`, params(name, op));
  track(response, [200]);
  const body = parse(response);
  check(response, {
    [`${op}: 200`]: (r) => r.status === 200,
    [`${op}: misma reserva`]: () => body?.id === id && isReserva(body),
  });
  return response.status === 200 ? body : null;
};

export const listar = (page = 1, pageSize = 20) => {
  const query = page === 1 && pageSize === 20 ? '' : `?page=${page}&pageSize=${pageSize}`;
  const response = http.get(`${BASE_URL}/reservas${query}`, params('GET /reservas', 'list'));
  track(response, [200]);
  const body = parse(response);
  check(response, {
    'listar: 200': (r) => r.status === 200,
    'listar: { reservas: [] }': () => Array.isArray(body?.reservas),
  });
  return response;
};

export const actualizar = (id, cambios) => {
  const response = http.patch(
    `${BASE_URL}/reservas/${id}`,
    JSON.stringify(cambios),
    params('PATCH /reservas/:id', 'update'),
  );
  track(response, [200]);
  const body = parse(response);
  check(response, {
    'actualizar: 200': (r) => r.status === 200,
    'actualizar: cambio aplicado': () =>
      Object.entries(cambios).every(([key, value]) =>
        key === 'fechaHoraProgramada'
          ? Date.parse(body?.[key]) === Date.parse(value)
          : body?.[key] === value,
      ),
  });
  if (
    response.status === 200 &&
    (cambios.vehiculo !== undefined || cambios.destino !== undefined)
  ) {
    pricingDegraded.add(body?.tarifaEstimada === null);
  }
  return response.status === 200 ? body : null;
};

export const cancelar = (id) => {
  const response = http.del(
    `${BASE_URL}/reservas/${id}`,
    null,
    params('DELETE /reservas/:id', 'cancel'),
  );
  track(response, [200]);
  const body = parse(response);
  check(response, {
    'cancelar: 200': (r) => r.status === 200,
    // DELETE es cancelación lógica: la reserva persiste en estado CANCELADA.
    'cancelar: estado CANCELADA': () => body?.estado === 'CANCELADA',
  });
  return response.status === 200 ? body : null;
};

/**
 * Variante para concurrencia: 409 es un resultado ESPERADO solo aquí y se cuenta en
 * `m9_expected_conflicts`; cualquier otro status distinto de 200 sigue siendo inesperado.
 */
export const conflictive = (method, id, body) => {
  const url = `${BASE_URL}/reservas/${id}`;
  const name = method === 'PATCH' ? 'PATCH /reservas/:id' : 'DELETE /reservas/:id';
  const op = method === 'PATCH' ? 'update' : 'cancel';
  const options = params(name, op, { expected: [200, 409], tags: { concurrency: 'shared' } });
  const response =
    method === 'PATCH'
      ? http.patch(url, JSON.stringify(body), options)
      : http.del(url, null, options);
  if (response.status === 409) {
    expectedConflicts.add(1, { op });
    const code = parse(response)?.error?.codigo;
    check(response, {
      '409 con código de negocio conocido': () =>
        ['RESERVA_EN_PROCESO', 'RESERVA_NO_MODIFICABLE', 'RESERVA_NO_CANCELABLE'].includes(code),
    });
  }
  unexpectedErrors.add(response.status !== 200 && response.status !== 409);
  return response;
};

/**
 * Verifica la idempotencia e inmutabilidad de estado tras cancelar:
 *   1) Un segundo DELETE sobre la misma reserva devuelve 409 RESERVA_NO_CANCELABLE.
 *   2) Un PATCH sobre la reserva ya cancelada devuelve 409 RESERVA_NO_MODIFICABLE.
 */
export const verificarIdempotenciaCancelacion = (id, patchPayload = { vehiculo: 'MOTO' }) => {
  const delAgain = http.del(
    `${BASE_URL}/reservas/${id}`,
    null,
    params('DELETE /reservas/:id (idempotencia)', 'idempotency', { expected: [409] }),
  );
  const delCode = parse(delAgain)?.error?.codigo;
  const delOk = delAgain.status === 409 && delCode === 'RESERVA_NO_CANCELABLE';
  check(delAgain, {
    'idempotencia: doble DELETE devuelve 409 RESERVA_NO_CANCELABLE': () => delOk,
  });
  idempotencyChecks.add(1, { op: 'cancel_repeat' });
  unexpectedErrors.add(!delOk);

  const patchAfterCancel = http.patch(
    `${BASE_URL}/reservas/${id}`,
    JSON.stringify(patchPayload),
    params('PATCH /reservas/:id (post-cancel)', 'idempotency', { expected: [409] }),
  );
  const patchCode = parse(patchAfterCancel)?.error?.codigo;
  const patchOk = patchAfterCancel.status === 409 && patchCode === 'RESERVA_NO_MODIFICABLE';
  check(patchAfterCancel, {
    'idempotencia: PATCH tras cancelar devuelve 409 RESERVA_NO_MODIFICABLE': () => patchOk,
  });
  idempotencyChecks.add(1, { op: 'update_after_cancel' });
  unexpectedErrors.add(!patchOk);
};

/**
 * Prueba rechazos de negocio controlados (400 / 404) para verificar validaciones y métricas
 * m9_reservation_operations_total{result="rejected"} sin contaminar errores inesperados.
 */
export const rechazoEsperadoCrear = (payload, expectedCode) => {
  const response = http.post(
    `${BASE_URL}/reservas`,
    JSON.stringify(payload),
    params('POST /reservas (rechazo esperado)', 'validation', { expected: [400] }),
  );
  const code = parse(response)?.error?.codigo;
  const ok = response.status === 400 && code === expectedCode;
  check(response, {
    [`validación: 400 ${expectedCode}`]: () => ok,
  });
  expectedRejections.add(1, { code: expectedCode });
  unexpectedErrors.add(!ok);
  return response;
};
