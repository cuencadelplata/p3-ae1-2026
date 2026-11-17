import { createServer } from 'node:http';

const port = Number(process.env.PORT ?? 4011);
const e2eOperatorToken = 'Bearer e2e-operator';

function json(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
  if (request.method === 'GET' && url.pathname === '/health') {
    json(response, 200, { status: 'ok' });
    return;
  }

  if (request.method === 'GET' && url.pathname === '/auth/validar-identidad-y-rol') {
    if (request.headers.authorization === e2eOperatorToken) {
      json(response, 200, { userId: 1, role: 'OPERADOR' });
      return;
    }
    json(response, 401, { error: { code: 'INVALID_AUTH_TOKEN', message: 'Token no reconocido por M1' } });
    return;
  }

  json(response, 404, { error: { code: 'NOT_FOUND', message: 'Ruta no encontrada' } });
});

server.listen(port);
