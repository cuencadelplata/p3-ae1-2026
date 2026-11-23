import { createServer } from 'node:http';

const provider = process.env.PROVIDER;
const apiKey = process.env.INTERNAL_API_KEY;
const payments = new Map();
const qrs = new Map();
const validationOperations = new Map();

const server = createServer(async (request, response) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
  const send = (status, data) => {
    response.writeHead(status, { 'content-type': 'application/json' });
    response.end(JSON.stringify(data));
  };

  if (request.method === 'GET' && request.url === '/health') {
    return send(200, { status: 'ok' });
  }

  if (provider === 'm8' && request.method === 'POST' && request.url === '/qr') {
    if (request.headers['x-api-key'] !== apiKey) return send(401, { error: { code: 'UNAUTHORIZED' } });
    if (typeof body.tripId !== 'string' || !body.tripId) return send(400, { error: { code: 'TRIP_ID_REQUIRED' } });
    let qr = qrs.get(body.tripId);
    if (!qr || qr.used || Date.parse(qr.expiresAt) <= Date.now()) {
      qr = {
        token: `e2e-${body.tripId}-${Date.now()}`,
        expiresAt: new Date(Date.now() + 300_000).toISOString(),
        used: false,
      };
      qrs.set(body.tripId, qr);
    }
    return send(201, { token: qr.token, qrDataUrl: 'data:image/png;base64,dGVzdA==', expiresAt: qr.expiresAt });
  }

  if (provider === 'm8' && request.method === 'POST' && request.url === '/qr/validate') {
    if (request.headers['x-api-key'] !== apiKey) return send(401, { error: { code: 'UNAUTHORIZED' } });
    const operationId = request.headers['idempotency-key'];
    const prior = operationId ? validationOperations.get(operationId) : undefined;
    if (prior) return send(prior.status, prior.body);
    const qr = qrs.get(body.tripId);
    if (!qr || qr.token !== body.token) return send(404, { error: { code: 'QR_NOT_FOUND' } });
    if (qr.used) return send(409, { error: { code: 'QR_ALREADY_USED' } });
    if (Date.parse(qr.expiresAt) <= Date.now()) return send(410, { error: { code: 'QR_EXPIRED' } });
    qr.used = true;
    const result = { status: 200, body: { valid: true } };
    if (operationId) validationOperations.set(operationId, result);
    return send(result.status, result.body);
  }

  if (provider === 'm7' && request.method === 'POST' && request.url === '/tarifa/estimacion') {
    const multiplier = body.vehicleType === 'moto' ? 0.7 : body.vehicleType === 'auto' ? 1 : undefined;
    if (!multiplier || Number(body.distanciaKm) <= 0 || Number(body.tiempoEstimadoMin) <= 0) {
      return send(400, { error: 'Solicitud de estimación inválida' });
    }
    const fare = Math.round((500 + Number(body.distanciaKm) * 250 + Number(body.tiempoEstimadoMin) * 50) * multiplier * 100) / 100;
    return send(200, { estimacionId: `e2e-${Date.now()}`, estimatedFare: fare, currency: 'ARS' });
  }

  if (provider === 'm7' && request.url.startsWith('/metodo-pago')) {
    if (request.headers['x-api-key'] !== apiKey) return send(401, { mensaje: 'API key inválida o ausente' });
    if (request.method === 'POST' && request.url === '/metodo-pago') {
      const { clienteId, viajeId, tipo } = body;
      if (!clienteId || !viajeId || !tipo) return send(400, { mensaje: 'Datos del pago inválidos' });
      if (payments.has(viajeId)) return send(400, { mensaje: 'El viaje ya tiene un pago registrado' });
      const payment = { pagoId: `PAY-${viajeId}`, clienteId, viajeId, tipo, estado: 'pendiente' };
      payments.set(viajeId, payment);
      return send(201, payment);
    }

    const match = request.url.match(/^\/metodo-pago\/([^/]+)(?:\/(autorizar))?$/);
    if (!match) return send(404, { mensaje: 'Ruta no encontrada' });
    const tripId = decodeURIComponent(match[1]);
    const payment = payments.get(tripId);
    if (!payment) return send(404, { mensaje: 'No se encontró un pago para ese viaje' });
    if (request.method === 'GET' && !match[2]) return send(200, payment);
    if (request.method === 'POST' && match[2] === 'autorizar') {
      if (body.token === 'rechazado') return send(402, { mensaje: 'El pago no fue aprobado por Mercado Pago' });
      if (payment.estado !== 'pendiente' || typeof body.total !== 'number' || !body.idOrden) {
        return send(400, { mensaje: 'No se pudo autorizar el pago' });
      }
      payment.estado = 'autorizado';
      payment.paymentId = `MP-${tripId}`;
      return send(200, payment);
    }
  }

  if (provider === 'm3' && request.method === 'GET' && /^\/api\/conductor\/[^/]+\/estado$/.test(request.url)) {
    const conductorId = decodeURIComponent(request.url.split('/')[3]);
    return send(conductorId.startsWith('inexistente') ? 404 : 200, {
      usuarioID: conductorId,
      habilitado: conductorId !== 'suspendido',
      disponible: conductorId !== 'suspendido',
      estado: conductorId === 'suspendido' ? 'suspendido' : 'activo',
      estado_conexion: conductorId === 'suspendido' ? 'desconectado' : 'conectado',
    });
  }

  if (provider === 'm4' && request.method === 'POST' && request.url === '/api/v1/estimate') {
    // Distancia en línea recta entre las coordenadas y ETA a 25 km/h, como el simulador anterior.
    const origin = coordenadas(body.origin);
    const destination = coordenadas(body.destination);
    if (!origin || !destination) return send(400, { error: 'Coordenadas de origen y destino inválidas' });
    const distanceKm = haversineKm(origin, destination);
    return send(200, {
      distanceKm: Math.round(distanceKm * 100) / 100,
      estimatedEtaMinutes: Math.max(1, Math.ceil((distanceKm / 25) * 60)),
    });
  }

  return send(404, { error: 'Not found' });
});

function coordenadas(value) {
  if (!value || typeof value !== 'object') return undefined;
  const { latitude, longitude } = value;
  const valida = (n, max) => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= max;
  return valida(latitude, 90) && valida(longitude, 180) ? { latitude, longitude } : undefined;
}

function haversineKm(origin, destination) {
  const rad = (grados) => (grados * Math.PI) / 180;
  const dLat = rad(destination.latitude - origin.latitude);
  const dLon = rad(destination.longitude - origin.longitude);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(rad(origin.latitude)) * Math.cos(rad(destination.latitude)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const port = Number(process.env.PORT ?? 3000);
server.listen(port, '0.0.0.0');