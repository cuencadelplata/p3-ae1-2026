import { createServer } from 'node:http';
import amqp from 'amqplib';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
export function applyDriverCancellation(requests, event) {
    const request = requests.get(event.viajeId);
    if (!request || event.evento !== 'cancelacion_conductor')
        return false;
    request.status = 'SEARCHING';
    request.assignedDriverId = null;
    if (!request.excludedDriverIds.includes(event.conductorId)) {
        request.excludedDriverIds.push(event.conductorId);
    }
    return true;
}
export class M5DispatchSimulator {
    requests = new Map();
    events = [];
    connection;
    channel;
    httpServer;
    async start(port = Number(process.env.M5_SIMULATOR_PORT ?? 3002)) {
        this.connection = await amqp.connect(process.env.RABBITMQ_URL ?? 'amqp://127.0.0.1:5672');
        this.channel = await this.connection.createChannel();
        await this.channel.assertQueue('despacho.reabrir', { durable: true });
        await this.channel.consume('despacho.reabrir', (message) => {
            if (!message)
                return;
            try {
                const event = JSON.parse(message.content.toString());
                this.events.push(event);
                applyDriverCancellation(this.requests, event);
                this.channel?.ack(message);
            }
            catch {
                this.channel?.nack(message, false, false);
            }
        });
        this.httpServer = createServer((request, response) => this.handleHttp(request, response));
        await new Promise((resolveListen, reject) => {
            this.httpServer?.once('error', reject);
            this.httpServer?.listen(port, '0.0.0.0', resolveListen);
        });
        return this.httpServer.address().port;
    }
    async close() {
        if (this.httpServer?.listening) {
            await new Promise((resolveClose, reject) => {
                this.httpServer?.close((error) => error ? reject(error) : resolveClose());
            });
        }
        await this.channel?.close();
        await this.connection?.close();
    }
    async handleHttp(request, response) {
        try {
            const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
            if (request.method === 'POST' && pathname === '/simulator/requests') {
                const input = await readJson(request);
                if (!input.viajeId || !input.clienteId || !input.conductorId) {
                    return send(response, 400, { error: 'viajeId, clienteId y conductorId son obligatorios' });
                }
                const simulatedRequest = {
                    viajeId: String(input.viajeId),
                    clienteId: String(input.clienteId),
                    status: 'ASSIGNED',
                    assignedDriverId: String(input.conductorId),
                    excludedDriverIds: [],
                };
                this.requests.set(simulatedRequest.viajeId, simulatedRequest);
                return send(response, 201, simulatedRequest);
            }
            if (request.method === 'GET' && pathname === '/simulator/events') {
                return send(response, 200, { events: this.events });
            }
            const match = pathname.match(/^\/simulator\/requests\/([^/]+)$/);
            if (request.method === 'GET' && match) {
                const simulatedRequest = this.requests.get(decodeURIComponent(match[1]));
                return simulatedRequest
                    ? send(response, 200, simulatedRequest)
                    : send(response, 404, { error: 'Solicitud no encontrada' });
            }
            return send(response, 404, { error: 'Ruta no encontrada' });
        }
        catch (error) {
            const message = error instanceof Error ? error.message : 'Solicitud inválida';
            return send(response, 400, { error: message });
        }
    }
}
async function readJson(request) {
    let body = '';
    for await (const chunk of request)
        body += chunk;
    return body ? JSON.parse(body) : {};
}
function send(response, status, body) {
    response.writeHead(status, { 'content-type': 'application/json' });
    response.end(JSON.stringify(body));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    const simulator = new M5DispatchSimulator();
    simulator.start().then((port) => console.log(`Simulador M5 escuchando en ${port}`));
    process.once('SIGINT', () => void simulator.close());
    process.once('SIGTERM', () => void simulator.close());
}
