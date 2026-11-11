import { createServer } from 'node:http';

createServer((request, response) => {
  if (request.method === 'GET' && /^\/internal\/preferences\/[1-9]\d*$/.test(request.url ?? '')) {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ data: { notificationsEnabled: true, pushEnabled: true } }));
    return;
  }
  response.writeHead(404).end();
}).listen(4012);
