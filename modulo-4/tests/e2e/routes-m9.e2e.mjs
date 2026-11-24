import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

const base = process.env.M4_E2E_URL || 'http://m4-api:3004/api/v1';

async function post(operation, body) {
  const response = await fetch(`${base}/${operation}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-correlation-id': `m9-contract-${randomUUID()}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  });
  assert.equal(response.status, 200, `${operation} debe responder sin Bearer dentro de 5 segundos`);
  return response.json();
}

test('contrato de rutas para M9: dos geocodificaciones y una estimación sin Bearer', async () => {
  const origin = await post('geocode', { address: 'Plaza 25 de Mayo, Corrientes, Argentina' });
  // Espaciar consultas al proveedor público; esta prueba no genera carga.
  await new Promise((resolve) => setTimeout(resolve, 1100));
  const destination = await post('geocode', { address: 'Terminal de Corrientes, Argentina' });
  for (const point of [origin, destination]) {
    assert.equal(point.provider, 'EXTERNAL_HTTP', 'requiere proveedor externo real');
    assert.ok(Number.isFinite(point.latitude) && Math.abs(point.latitude) <= 90);
    assert.ok(Number.isFinite(point.longitude) && Math.abs(point.longitude) <= 180);
  }
  const route = await post('estimate', {
    origin: { latitude: origin.latitude, longitude: origin.longitude },
    destination: { latitude: destination.latitude, longitude: destination.longitude },
  });
  assert.ok(Number.isFinite(route.distanceKm) && route.distanceKm > 0);
  assert.ok(Number.isFinite(route.estimatedEtaMinutes) && route.estimatedEtaMinutes > 0);
});

test('puntos idénticos: M4 devuelve cero kilómetros y un minuto mínimo', async () => {
  const point = { latitude: -27.4692, longitude: -58.8306 };
  const route = await post('estimate', { origin: point, destination: point });
  assert.equal(route.distanceKm, 0);
  assert.equal(route.estimatedEtaMinutes, 1);
});
