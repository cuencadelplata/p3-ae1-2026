import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

interface CapturedRequest {
  method?: string;
  url?: string;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

let server: Server;
let capturedRequest: CapturedRequest | undefined;
let responseStatus = 201;
let responseBody: unknown;
let responseHeaders: Record<string, string> = {};
let previousUrl: string | undefined;
let previousKey: string | undefined;
let qrService: typeof import('../../src/rf-6.1-6.2-6.3/services/qr.service.js');

beforeAll(async () => {
  previousUrl = process.env.M8_URL;
  previousKey = process.env.M8_QR_API_KEY;
  server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    capturedRequest = {
      method: request.method,
      url: request.url,
      headers: request.headers,
      body: Buffer.concat(chunks).toString('utf8'),
    };
    response.writeHead(responseStatus, { 'content-type': 'application/json', ...responseHeaders });
    response.end(JSON.stringify(responseBody));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  process.env.M8_URL = `http://127.0.0.1:${port}`;
  process.env.M8_QR_API_KEY = 'test-only-key';
  qrService = await import('../../src/rf-6.1-6.2-6.3/services/qr.service.js');
});

beforeEach(() => {
  capturedRequest = undefined;
  responseStatus = 201;
  responseBody = {
    token: 'qr-token',
    qrDataUrl: 'data:image/png;base64,test',
    expiresAt: '2026-11-15T20:00:00.000Z',
  };
  responseHeaders = {};
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  if (previousUrl === undefined) delete process.env.M8_URL;
  else process.env.M8_URL = previousUrl;
  if (previousKey === undefined) delete process.env.M8_QR_API_KEY;
  else process.env.M8_QR_API_KEY = previousKey;
});

describe('Cliente HTTP de QR M8', () => {
  it('genera QR con tripId y x-api-key y exige HTTP 201', async () => {
    await qrService.generarQR('trip-demo-001');

    expect(capturedRequest?.method).toBe('POST');
    expect(capturedRequest?.url).toBe('/qr');
    expect(JSON.parse(capturedRequest!.body)).toEqual({ tripId: 'trip-demo-001' });
    expect(capturedRequest?.headers['x-api-key']).toBe('test-only-key');
  });

  it('valida con tripId/token, x-api-key e Idempotency-Key UUID estable', async () => {
    const tripId = 'trip-demo-001';
    const token = 'qr-token';
    const firstKey = qrService.crearClaveIdempotenciaQR(tripId, token);
    const retryKey = qrService.crearClaveIdempotenciaQR(tripId, token);

    responseStatus = 200;
    responseBody = { valid: true };
    await expect(qrService.validarQR(tripId, token)).resolves.toEqual({ valid: true });

    expect(firstKey).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(retryKey).toBe(firstKey);
    expect(capturedRequest?.method).toBe('POST');
    expect(capturedRequest?.url).toBe('/qr/validate');
    expect(JSON.parse(capturedRequest!.body)).toEqual({ tripId, token });
    expect(capturedRequest?.headers['x-api-key']).toBe('test-only-key');
    expect(capturedRequest?.headers['idempotency-key']).toBe(firstKey);
  });

  it('preserva el código de error y Retry-After de M8', async () => {
    responseStatus = 503;
    responseBody = { error: { code: 'QR_STORE_UNAVAILABLE' } };
    responseHeaders = { 'retry-after': '5' };

    await expect(qrService.validarQR('trip-demo-001', 'qr-token')).rejects.toMatchObject({
      status: 503,
      code: 'QR_STORE_UNAVAILABLE',
      retryAfter: '5',
    });
  });
});