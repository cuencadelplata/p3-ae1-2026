/**
 * Receptor OTLP/HTTP local que SIMULA el endpoint de Grafana Cloud para verificar el tramo
 * Alloy -> "cloud" sin cuenta. No decodifica protobuf: cuenta solicitudes y bytes por señal y
 * comprueba que Alloy envía Basic Auth (sin mostrar las credenciales).
 *
 *   node scripts/otlp-sink.mjs [puerto=4319] [segundos=0 (sin límite)]
 *
 * En .env de prueba: GRAFANA_CLOUD_OTLP_ENDPOINT=http://host.docker.internal:4319/otlp
 */
import { createServer } from 'node:http';

const port = Number(process.argv[2] ?? 4319);
const seconds = Number(process.argv[3] ?? 0);
const stats = {};

const server = createServer((request, response) => {
  let bytes = 0;
  request.on('data', (chunk) => (bytes += chunk.length));
  request.on('end', () => {
    const signal = (request.url ?? '').split('/').pop() ?? 'desconocida';
    const entry = (stats[signal] ??= { requests: 0, bytes: 0, basicAuth: 0, contentType: '' });
    entry.requests += 1;
    entry.bytes += bytes;
    if ((request.headers.authorization ?? '').startsWith('Basic ')) entry.basicAuth += 1;
    entry.contentType = request.headers['content-type'] ?? '';
    response.writeHead(200, { 'content-type': 'application/x-protobuf' });
    response.end();
  });
});

const report = () => {
  console.log(JSON.stringify({ at: new Date().toISOString(), stats }));
};

server.listen(port, '0.0.0.0', () => console.log(`otlp-sink escuchando en :${port}`));
const timer = setInterval(report, 15_000);
if (seconds > 0) {
  setTimeout(() => {
    clearInterval(timer);
    report();
    server.close();
  }, seconds * 1000);
}
