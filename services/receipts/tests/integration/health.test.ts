import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, afterEach, before, describe, it, mock } from 'node:test';

import { createApp, type AppOptions } from '../../src/app';
import { closeRedis, connectRedis } from '../../src/cache/redis';
import { runMigrations } from '../../src/db/migrations';
import { toReceiptRequest } from '../../src/messaging/payment-confirmed';
import { issueReceipt, resendReceipt } from '../../src/services/receipt.service';
import { paymentConfirmedEvent } from '../helpers/payment-confirmed.fixture';

interface ReadyBody {
  status: string;
  dependencies: Record<string, { status: string; critical: boolean }>;
  circuits: Record<string, string>;
}

const up = async (): Promise<boolean> => true;
const down = async (): Promise<boolean> => false;

describe('Salud y trazabilidad (Integration HTTP + PostgreSQL + Redis)', () => {
  const servers: Server[] = [];

  async function start(options: AppOptions = {}): Promise<string> {
    const server = createApp(options).listen(0);
    await new Promise<void>((resolve) => server.once('listening', () => resolve()));
    servers.push(server);
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }

  before(async () => {
    await runMigrations();
    await connectRedis();
  });

  afterEach(() => {
    mock.restoreAll();
  });

  after(async () => {
    await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))));
    await closeRedis();
  });

  it('/health/ready debe informar cada dependencia real como disponible', async () => {
    const baseUrl = await start({ checks: { rabbitmq: up } });

    const res = await fetch(`${baseUrl}/health/ready`);
    const body = (await res.json()) as ReadyBody;

    assert.equal(res.status, 200);
    assert.equal(body.status, 'ok');
    assert.deepEqual(body.dependencies['postgres'], { status: 'available', critical: true });
    assert.deepEqual(body.dependencies['redis'], { status: 'available', critical: false });
    assert.deepEqual(body.dependencies['rabbitmq'], { status: 'available', critical: false });
    assert.deepEqual(body.dependencies['fiscal'], { status: 'available', critical: false });
    assert.deepEqual(body.circuits, { fiscal: 'closed' });
  });

  it('sin el autorizador fiscal el servicio sigue disponible pero degradado', async () => {
    const baseUrl = await start({ checks: { rabbitmq: up, fiscal: down } });

    const res = await fetch(`${baseUrl}/health/ready`);
    const body = (await res.json()) as ReadyBody;

    assert.equal(res.status, 200);
    assert.equal(body.status, 'degraded');
    assert.deepEqual(body.dependencies['fiscal'], { status: 'unavailable', critical: false });
  });

  it('sin Redis o sin RabbitMQ el servicio sigue disponible pero degradado', async () => {
    const baseUrl = await start({ checks: { redis: down, rabbitmq: down } });

    const res = await fetch(`${baseUrl}/health/ready`);
    const body = (await res.json()) as ReadyBody;

    assert.equal(res.status, 200);
    assert.equal(body.status, 'degraded');
    assert.equal(body.dependencies['postgres']?.status, 'available');
    assert.equal(body.dependencies['redis']?.status, 'unavailable');
    assert.equal(body.dependencies['rabbitmq']?.status, 'unavailable');
  });

  it('sin PostgreSQL /health/ready debe responder 503, pero /health/live sigue en 200', async () => {
    const baseUrl = await start({ checks: { postgres: down, rabbitmq: up } });

    const ready = await fetch(`${baseUrl}/health/ready`);
    assert.equal(ready.status, 503);
    assert.equal(((await ready.json()) as ReadyBody).status, 'unavailable');

    const live = await fetch(`${baseUrl}/health/live`);
    assert.equal(live.status, 200);
    assert.equal(((await live.json()) as { status: string }).status, 'ok');
  });

  it('una dependencia que no responde a tiempo debe contarse como no disponible', async () => {
    const hangs = () => new Promise<boolean>(() => undefined);
    const baseUrl = await start({ checks: { rabbitmq: up, redis: hangs } });

    const startedAt = Date.now();
    const body = (await (await fetch(`${baseUrl}/health/ready`)).json()) as ReadyBody;

    assert.equal(body.dependencies['redis']?.status, 'unavailable');
    assert.ok(Date.now() - startedAt < 4000);
  });

  it('/health debe seguir respondiendo como alias de /health/ready', async () => {
    const baseUrl = await start({ checks: { rabbitmq: up } });
    const body = (await (await fetch(`${baseUrl}/health`)).json()) as ReadyBody;
    assert.equal(body.status, 'ok');
    assert.ok(body.dependencies['postgres']);
  });

  it('debe devolver el X-Correlation-Id recibido o generar uno', async () => {
    const baseUrl = await start();

    const propagated = await fetch(`${baseUrl}/health/live`, { headers: { 'X-Correlation-Id': 'trip-2026-000123' } });
    assert.equal(propagated.headers.get('x-correlation-id'), 'trip-2026-000123');

    const generated = await fetch(`${baseUrl}/health/live`);
    assert.match(generated.headers.get('x-correlation-id') ?? '', /^[0-9a-f-]{36}$/);

    const rejected = await fetch(`${baseUrl}/health/live`, { headers: { 'X-Correlation-Id': 'no valido <script>' } });
    assert.notEqual(rejected.headers.get('x-correlation-id'), 'no valido <script>');
  });

  it('el log de la solicitud debe llevar el correlationId y no debe incluir el token de descarga', async () => {
    const baseUrl = await start();
    const lines: Array<Record<string, unknown>> = [];
    mock.method(console, 'info', (line: string) => lines.push(JSON.parse(line) as Record<string, unknown>));

    const token = 'T'.repeat(43);
    await fetch(`${baseUrl}/api/v1/receipts/downloads/${token}`, { headers: { 'X-Correlation-Id': 'corr-123' } });
    await new Promise((resolve) => setImmediate(resolve));

    const access = lines.find((entry) => entry['message'] === 'solicitud atendida');
    assert.equal(access?.['correlationId'], 'corr-123');
    assert.equal(access?.['status'], 410);
    assert.equal(access?.['path'], '/api/v1/receipts/downloads/:token');
    assert.ok(!JSON.stringify(lines).includes(token));
  });

  it('el log de un reenvio no debe incluir el destino ni datos del cliente', async () => {
    const tripId = `trip-log-${Date.now()}`;
    const request = toReceiptRequest(paymentConfirmedEvent(tripId));
    assert.ok(request.ok);
    await issueReceipt(request.value);

    const lines: string[] = [];
    mock.method(console, 'info', (line: string) => lines.push(line));
    await resendReceipt(tripId, 'EMAIL', 'destino.privado@example.com');

    const output = lines.join('\n');
    assert.ok(output.includes(tripId));
    for (const personal of ['destino.privado', 'example.com', 'Lucia Fernandez', 'lucia.fernandez']) {
      assert.ok(!output.includes(personal), `el log no debe contener "${personal}"`);
    }
  });
});
