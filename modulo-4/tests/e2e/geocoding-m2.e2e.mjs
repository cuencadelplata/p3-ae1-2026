import assert from 'node:assert/strict';
import test from 'node:test';
import { loginNewUser, request } from './helpers.mjs';

const m2 = process.env.M2_E2E_URL;
const m4 = process.env.M4_E2E_URL || 'http://m4-api:3004/api/v1';

test('M2 autentica al pasajero en M1 y obtiene coordenadas desde M4', {
  skip: !m2,
}, async () => {
  const passenger = await loginNewUser('CLIENTE');
  const address = 'Obelisco, Buenos Aires';
  const url = `${m2}/api/v1/geocodificacion?${new URLSearchParams({ q: address })}`;
  await request(url, 401);
  const direct = await request(`${m4}/geocode`, 200, { method: 'POST', body: { address } });
  assert.equal(direct.provider, 'EXTERNAL_HTTP', 'este caso requiere geocodificación externa real');
  // Separar las consultas al proveedor público; no es una prueba de carga.
  await new Promise((resolve) => setTimeout(resolve, 1100));
  const response = await request(url, 200, { token: passenger.token });
  assert.equal(response.data.length, 1);
  const [point] = response.data;
  assert.equal(point.direccion, direct.address);
  assert.equal(point.latitud, direct.latitude);
  assert.equal(point.longitud, direct.longitude);
  assert.ok(Math.abs(point.latitud + 34.6037) < 0.01);
  assert.ok(Math.abs(point.longitud + 58.3816) < 0.01);
});
