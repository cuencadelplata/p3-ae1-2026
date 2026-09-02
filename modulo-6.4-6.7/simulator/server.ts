import { createServer, type Server } from 'node:http';

export function createSimulator(): Server {
  return createServer(async (request, response) => {
  let body = '';
  for await (const chunk of request) body += chunk;
  const input = body ? JSON.parse(body) as Record<string, number | string> : {};
  let result: Record<string, boolean | number | string>;

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