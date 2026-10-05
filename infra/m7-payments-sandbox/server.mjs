/**
 * API de pagos de M7 simulada (sandbox) para el servicio de comprobantes (RF-8.3).
 *
 * Reproduce el subconjunto del contrato publicado por M7 (openapi.yaml de la
 * rama M7, RF-7.2 y RF-7.3) que usa el servicio de comprobantes. Es un servicio
 * externo al modulo: corre en su propio contenedor y solo se accede por HTTP.
 *
 * Contrato (igual al de M7):
 *   POST /metodo-pago                      { clienteId, viajeId, tipo } -> 201 en estado "pendiente"
 *   GET  /metodo-pago/{viajeId}            200 MetodoPago | 404 { mensaje }
 *   POST /metodo-pago/{viajeId}/autorizar  "pendiente" -> "autorizado" | 400 | 404
 *   POST /metodo-pago/{viajeId}/rechazar   "pendiente" -> "rechazado"  | 400 | 404
 *   MetodoPago: { pagoId, clienteId, viajeId, tipo, detalle, fecha, estado }
 *
 * Agregados del sandbox:
 *   GET  /health
 *   GET|PUT /admin/mode   { mode: "normal" | "slow" | "down" }, igual que el fiscal-sandbox.
 *
 * UNREGISTERED_TRIPS define que responde la consulta de un viaje sin pago
 * registrado:
 *   autorizado (por defecto): un pago autorizado con tipo DEFAULT_TIPO, para que
 *     los flujos de demostracion y las pruebas existentes no tengan que registrar
 *     el pago antes de emitir. No representa datos reales de M7.
 *   not_found: 404, como responde M7.
 *
 * Los pagos se guardan en memoria: al reiniciar el contenedor se pierden.
 */
import { createServer } from 'node:http';

const PORT = Number(process.env.PORT ?? 4020);
const SLOW_DELAY_MS = Number(process.env.SLOW_DELAY_MS ?? 5000);
const MODES = ['normal', 'slow', 'down'];
const TIPOS = ['efectivo', 'tarjeta', 'transferencia'];
const UNREGISTERED_TRIPS = process.env.UNREGISTERED_TRIPS === 'not_found' ? 'not_found' : 'autorizado';
const DEFAULT_TIPO = TIPOS.includes(process.env.DEFAULT_TIPO) ? process.env.DEFAULT_TIPO : 'tarjeta';

let mode = MODES.includes(process.env.M7_MODE) ? process.env.M7_MODE : 'normal';

/** viajeId -> MetodoPago */
const payments = new Map();

function log(level, message, fields = {}) {
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), level, service: 'm7-payments-sandbox', message, ...fields }));
}

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

function sendMessage(res, status, mensaje) {
  send(res, status, { mensaje });
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

function newPayment(clienteId, viajeId, tipo, estado) {
  return {
    pagoId: String(Math.random()),
    clienteId,
    viajeId,
    tipo,
    detalle: '',
    fecha: new Date().toLocaleDateString('es-AR'),
    estado,
  };
}

async function register(req, res) {
  const body = await readJson(req);
  const { clienteId, viajeId, tipo } = body ?? {};
  if (typeof clienteId !== 'string' || clienteId.trim() === '' || typeof viajeId !== 'string' || viajeId.trim() === '') {
    return sendMessage(res, 400, 'clienteId y viajeId son obligatorios');
  }
  if (!TIPOS.includes(tipo)) {
    return sendMessage(res, 400, `tipo debe ser uno de: ${TIPOS.join(', ')}`);
  }
  if (payments.has(viajeId)) {
    return sendMessage(res, 400, `El viaje ${viajeId} ya tiene un metodo de pago registrado`);
  }
  const payment = newPayment(clienteId, viajeId, tipo, 'pendiente');
  payments.set(viajeId, payment);
  log('info', 'metodo de pago registrado', { viajeId, tipo });
  return send(res, 201, payment);
}

function find(res, viajeId) {
  const payment = payments.get(viajeId);
  if (payment) {
    return send(res, 200, payment);
  }
  if (UNREGISTERED_TRIPS === 'autorizado') {
    return send(res, 200, newPayment('cliente-sandbox', viajeId, DEFAULT_TIPO, 'autorizado'));
  }
  return sendMessage(res, 404, `No se encontro un pago para el viaje ${viajeId}`);
}

function transition(res, viajeId, estado) {
  const payment = payments.get(viajeId);
  if (!payment) {
    return sendMessage(res, 404, `No se encontro un pago para el viaje ${viajeId}`);
  }
  if (payment.estado !== 'pendiente') {
    return sendMessage(res, 400, `El pago esta ${payment.estado}; solo se puede cambiar un pago pendiente`);
  }
  payment.estado = estado;
  log('info', 'estado del pago cambiado', { viajeId, estado });
  return send(res, 200, payment);
}

async function changeMode(req, res) {
  const body = await readJson(req);
  if (!MODES.includes(body?.mode)) {
    return sendMessage(res, 422, `mode debe ser uno de: ${MODES.join(', ')}`);
  }
  mode = body.mode;
  log('warn', 'modo cambiado', { mode });
  return send(res, 200, { mode });
}

const PAYMENT_PATH = /^\/metodo-pago\/([^/]+)(?:\/(autorizar|rechazar))?$/;

const server = createServer((req, res) => {
  const path = new URL(req.url ?? '/', 'http://localhost').pathname;

  const handle = async () => {
    if (req.method === 'GET' && path === '/health') {
      return send(res, mode === 'down' ? 503 : 200, { status: mode === 'down' ? 'unavailable' : 'ok', mode });
    }
    if (req.method === 'GET' && path === '/admin/mode') {
      return send(res, 200, { mode });
    }
    if (req.method === 'PUT' && path === '/admin/mode') {
      return changeMode(req, res);
    }

    if (mode === 'down') {
      return sendMessage(res, 503, 'La API de pagos no esta disponible');
    }
    if (mode === 'slow') {
      await new Promise((resolve) => setTimeout(resolve, SLOW_DELAY_MS));
    }

    if (req.method === 'POST' && path === '/metodo-pago') {
      return register(req, res);
    }
    const match = PAYMENT_PATH.exec(path);
    if (match) {
      const viajeId = decodeURIComponent(match[1]);
      if (req.method === 'GET' && !match[2]) {
        return find(res, viajeId);
      }
      if (req.method === 'POST' && match[2]) {
        return transition(res, viajeId, match[2] === 'autorizar' ? 'autorizado' : 'rechazado');
      }
    }
    return sendMessage(res, 404, `La ruta ${req.method} ${path} no existe`);
  };

  handle().catch((error) => {
    log('error', 'error inesperado', { reason: error instanceof Error ? error.message : String(error) });
    if (!res.headersSent) {
      sendMessage(res, 500, 'Error inesperado');
    }
  });
});

server.listen(PORT, () =>
  log('info', 'API de pagos de M7 simulada escuchando', { port: PORT, mode, unregisteredTrips: UNREGISTERED_TRIPS }),
);

const shutdown = () => server.close(() => process.exit(0));
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
