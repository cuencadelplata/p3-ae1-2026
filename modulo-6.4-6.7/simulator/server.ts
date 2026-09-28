import { createServer, type Server } from 'node:http';

export function createSimulator(): Server {
  const metodosPago = new Map<string, Record<string, unknown>>();

  return createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    const input = body ? JSON.parse(body) as Record<string, unknown> : {};
    let result: Record<string, unknown> | undefined;

    if (request.method === 'POST' && request.url === '/tarifas/estimacion') {
      const vehicleType = input.vehicleType;
      const multiplier = vehicleType === 'moto' ? 0.7 : vehicleType === 'auto' ? 1 : undefined;
      if (!input.origen || !input.destino || !multiplier || Number(input.distanciaKm) <= 0 || Number(input.tiempoEstimadoMin) <= 0) {
        response.writeHead(400, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: 'Solicitud de estimación inválida' }));
        return;
      }

      const distanceCost = Number(input.distanciaKm) * 250;
      const timeCost = Number(input.tiempoEstimadoMin) * 50;
      result = {
        estimacionId: `est-${Date.now()}`,
        distanciaKm: Number(input.distanciaKm),
        tiempoEstimadoMin: Number(input.tiempoEstimadoMin),
        vehicleType,
        estimatedFare: Math.round((500 + distanceCost + timeCost) * multiplier * 100) / 100,
        currency: 'ARS',
        desglose: {
          tarifaBase: 500,
          costoDistancia: distanceCost,
          costoTiempo: timeCost,
          multiplicadorVehiculo: multiplier,
        },
        calculadoEn: new Date().toISOString(),
      };
    } else if (request.method === 'POST' && request.url === '/metodo-pago') {
      const { clienteId, viajeId, tipo } = input;
      if (typeof clienteId !== 'string' || typeof viajeId !== 'string' || typeof tipo !== 'string' || !['efectivo', 'tarjeta', 'transferencia'].includes(tipo)) {
        response.writeHead(400, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ mensaje: 'No se pudo registrar el método de pago' }));
        return;
      }
      const metodoPago = {
        pagoId: `PAY-${viajeId}`,
        clienteId,
        viajeId,
        tipo,
        fecha: new Date().toISOString(),
        detalle: '',
        estado: 'pendiente',
      };
      metodosPago.set(String(viajeId), metodoPago);
      result = metodoPago;
    } else {
      const paymentMatch = request.url?.match(/^\/metodo-pago\/([^/]+)(?:\/(autorizar|rechazar))?$/);
      if (paymentMatch) {
        const viajeId = decodeURIComponent(paymentMatch[1]);
        const metodoPago = metodosPago.get(viajeId);
        if (!metodoPago) {
          response.writeHead(404, { 'content-type': 'application/json' });
          response.end(JSON.stringify({ mensaje: 'No se encontró un pago para ese viaje' }));
          return;
        }
        if (request.method === 'GET' && !paymentMatch[2]) {
          result = metodoPago;
        } else if (request.method === 'POST' && paymentMatch[2] === 'autorizar' && input.idOrden) {
          metodoPago.estado = 'autorizado';
          result = metodoPago;
        } else if (request.method === 'POST' && paymentMatch[2] === 'rechazar') {
          metodoPago.estado = 'rechazado';
          result = metodoPago;
        } else {
          response.writeHead(400, { 'content-type': 'application/json' });
          response.end(JSON.stringify({ mensaje: 'Solicitud de pago inválida' }));
          return;
        }
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify(result));
        return;
      }
    }

    if (result) {
      response.writeHead(request.url === '/tarifas/estimacion' ? 200 : 201, { 'content-type': 'application/json' });
      response.end(JSON.stringify(result));
      return;
    }

    if (request.url === '/api/tarifas/estimacion') {
    result = { total: 150 + Number(input.distanciaKm) * 80 + Number(input.tiempoMinutos) * 25 };
    } else if (request.url === '/api/tarifas/cargo-cancelacion') {
    result = { cargo: input.estado === 'asignado' ? 200 : 0 };
    } else if (request.url === '/api/pagos/captura') {
    result = { paymentId: `PAY-${input.viajeId}` };
    } else if (request.url === '/api/despacho/reabrir') {
    result = {
      reabrirDespacho: true,
      clienteRetornado: true,
      viajeId: String(input.viajeId ?? ''),
      conductorId: String(input.conductorId ?? ''),
    };
    } else {
      response.writeHead(404).end();
      return;
    }

    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(result));
  });
}

if (process.argv[1]?.endsWith('/server.js') || process.argv[1]?.endsWith('simulator/server.js')) {
  const server = createSimulator();
  server.listen(Number(process.env.PORT ?? 3001), '0.0.0.0', () => {
    console.log(`Simulador de APIs escuchando en ${process.env.PORT ?? 3001}`);
  });
}