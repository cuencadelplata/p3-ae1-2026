/**
 * Autorizador fiscal simulado (sandbox) para el servicio de comprobantes (RF-8.3).
 *
 * Representa al organismo externo que autoriza cada comprobante electronico y
 * devuelve un codigo de autorizacion con fecha de vencimiento. Es un servicio
 * externo al modulo: corre en su propio contenedor, no comparte base de datos y
 * solo se accede por HTTP.
 *
 * Contrato:
 *   POST /v1/authorizations        (encabezado Idempotency-Key obligatorio)
 *     { tripId, issuedAt, currency, total }
 *     201 primera autorizacion | 200 misma clave y mismo pedido (idempotente)
 *     409 misma clave con otro pedido | 422 pedido invalido o rechazado
 *   GET  /health
 *   GET|PUT /admin/mode           { mode: "normal" | "slow" | "down" }
 *
 * El modo permite demostrar fallas sin tocar el servicio de comprobantes:
 *   normal: responde en el momento.
 *   slow:   demora SLOW_DELAY_MS antes de responder (para probar el timeout).
 *   down:   responde 503 a toda autorizacion.
 *
 * Las autorizaciones se guardan en memoria: al reiniciar el contenedor se
 * pierden, algo aceptable para un sandbox.
 */
import { createHash, randomInt } from 'node:crypto';
import { createServer } from 'node:http';

const PORT = Number(process.env.PORT ?? 4010);
const SLOW_DELAY_MS = Number(process.env.SLOW_DELAY_MS ?? 5000);
const MAX_TOTAL = Number(process.env.MAX_TOTAL ?? 10_000_000);
const VALIDITY_DAYS = 10;
const MODES = ['normal', 'slow', 'down'];

let mode = MODES.includes(process.env.FISCAL_MODE) ? process.env.FISCAL_MODE : 'normal';

/** Idempotency-Key -> { fingerprint, authorization } */
const authorizations = new Map();

function log(level, message, fields = {}) {
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), level, service: 'fiscal-sandbox', message, ...fields }));
}

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

function sendError(res, status, code, message) {
  send(res, status, { error: { code, message } });
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    return undefined;
  }
}

function validate(body) {
  const errors = [];
  if (typeof body?.tripId !== 'string' || body.tripId.trim() === '') {
    errors.push('tripId es obligatorio');
  }
  if (typeof body?.issuedAt !== 'string' || Number.isNaN(Date.parse(body.issuedAt))) {
    errors.push('issuedAt debe ser una fecha ISO 8601');
  }
  if (typeof body?.currency !== 'string' || !/^[A-Z]{3}$/.test(body.currency)) {
    errors.push('currency debe ser un codigo ISO 4217');
  }
  if (typeof body?.total !== 'number' || !Number.isFinite(body.total) || body.total < 0) {
    errors.push('total debe ser un numero mayor o igual a 0');
  }
  return errors;
}

/**
 * Datos que identifican el pedido para la idempotencia. issuedAt queda afuera:
 * el emisor lo recalcula en cada reintento y no cambia lo que se autoriza.
 */
function fingerprint(body) {
  const { tripId, currency, total } = body;
  return createHash('sha256').update(JSON.stringify([tripId, currency, total])).digest('hex');
}

function newAuthorization(body) {
  const expires = new Date(Date.parse(body.issuedAt) + VALIDITY_DAYS * 24 * 60 * 60 * 1000);
  // 14 digitos, como los codigos de autorizacion de comprobantes electronicos.
  const code = `${randomInt(1, 10)}${Array.from({ length: 13 }, () => randomInt(0, 10)).join('')}`;
  return {
    authorizationCode: code,
    expiresOn: expires.toISOString().slice(0, 10),
    authorizedAt: new Date().toISOString(),
  };
}

async function authorize(req, res) {
  if (mode === 'down') {
    sendError(res, 503, 'SERVICE_UNAVAILABLE', 'El autorizador fiscal no esta disponible');
    return;
  }
  if (mode === 'slow') {
    await new Promise((resolve) => setTimeout(resolve, SLOW_DELAY_MS));
  }

  const key = req.headers['idempotency-key'];
  if (typeof key !== 'string' || key.trim() === '') {
    sendError(res, 422, 'IDEMPOTENCY_KEY_REQUIRED', 'Falta el encabezado Idempotency-Key');
    return;
  }

  const body = await readJson(req);
  const errors = body === undefined ? ['el cuerpo no es un JSON valido'] : validate(body);
  if (errors.length > 0) {
    sendError(res, 422, 'INVALID_REQUEST', errors.join('; '));
    return;
  }
  if (body.total > MAX_TOTAL) {
    sendError(res, 422, 'AMOUNT_LIMIT_EXCEEDED', `El importe supera el maximo autorizable (${MAX_TOTAL})`);
    return;
  }

  const print = fingerprint(body);
  const previous = authorizations.get(key);
  if (previous) {
    if (previous.fingerprint !== print) {
      sendError(res, 409, 'IDEMPOTENCY_CONFLICT', 'La clave ya se uso para un pedido con otros datos');
      return;
    }
    log('info', 'autorizacion repetida, se devuelve la original', { idempotencyKey: key });
    send(res, 200, previous.authorization);
    return;
  }

  const authorization = newAuthorization(body);
  authorizations.set(key, { fingerprint: print, authorization });
  log('info', 'comprobante autorizado', { idempotencyKey: key, authorizationCode: authorization.authorizationCode });
  send(res, 201, authorization);
}

async function changeMode(req, res) {
  const body = await readJson(req);
  if (!MODES.includes(body?.mode)) {
    sendError(res, 422, 'INVALID_MODE', `mode debe ser uno de: ${MODES.join(', ')}`);
    return;
  }
  mode = body.mode;
  log('warn', 'modo cambiado', { mode });
  send(res, 200, { mode });
}

const server = createServer((req, res) => {
  const path = new URL(req.url ?? '/', 'http://localhost').pathname;

  const handle = async () => {
    if (req.method === 'POST' && path === '/v1/authorizations') {
      return authorize(req, res);
    }
    if (req.method === 'GET' && path === '/health') {
      return send(res, mode === 'down' ? 503 : 200, { status: mode === 'down' ? 'unavailable' : 'ok', mode });
    }
    if (req.method === 'GET' && path === '/admin/mode') {
      return send(res, 200, { mode });
    }
    if (req.method === 'PUT' && path === '/admin/mode') {
      return changeMode(req, res);
    }
    return sendError(res, 404, 'ROUTE_NOT_FOUND', `La ruta ${req.method} ${path} no existe`);
  };

  handle().catch((error) => {
    log('error', 'error inesperado', { reason: error instanceof Error ? error.message : String(error) });
    if (!res.headersSent) {
      sendError(res, 500, 'INTERNAL_ERROR', 'Error inesperado');
    }
  });
});

server.listen(PORT, () => log('info', 'autorizador fiscal simulado escuchando', { port: PORT, mode }));

const shutdown = () => server.close(() => process.exit(0));
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
