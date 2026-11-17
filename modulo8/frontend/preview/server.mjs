import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const port = Number(process.env.M8_FRONTEND_PORT || 4173);
const target = new URL(process.env.M8_API_TARGET || 'http://127.0.0.1:8000');
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };
const isApi = (path) => /^\/(?:api\/v1\/receipts(?:\/|$)|tickets(?:\/|$)|devices\/tokens(?:\/|$))/.test(path);

const server = createServer(async (request, response) => {
  const path = new URL(request.url || '/', 'http://localhost').pathname;
  if (isApi(path)) {
    try {
      const upstream = await fetch(new URL(request.url || '/', target), {
        method: request.method,
        headers: { ...request.headers, host: target.host },
        body: ['GET', 'HEAD'].includes(request.method || 'GET') ? undefined : request,
        duplex: 'half',
        redirect: 'manual',
      });
      response.writeHead(upstream.status, Object.fromEntries(upstream.headers));
      response.end(Buffer.from(await upstream.arrayBuffer()));
    } catch {
      response.writeHead(502, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: { message: 'No se pudo conectar con M8.' } }));
    }
    return;
  }
  const requested = path === '/' || !extname(path) ? 'preview/index.html' : path.slice(1);
  const filename = resolve(root, requested);
  if (!filename.startsWith(root) || !['.html', '.css', '.js', '.svg'].includes(extname(filename))) {
    response.writeHead(404).end(); return;
  }
  try {
    if (!(await stat(filename)).isFile()) throw new Error('not a file');
    response.writeHead(200, { 'content-type': mime[extname(filename)], 'cache-control': 'no-store' });
    response.end(await readFile(filename));
  } catch { response.writeHead(404).end(); }
});

let listenPort = port;
server.on('error', (error) => {
  if (error.code !== 'EADDRINUSE' || listenPort >= port + 5) throw error;
  listenPort += 1;
  server.listen(listenPort, '127.0.0.1');
});
server.on('listening', () => console.log(`M8 frontend: http://127.0.0.1:${listenPort}`));
server.listen(listenPort, '127.0.0.1');
