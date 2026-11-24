import assert from 'node:assert/strict';
import { randomInt, randomUUID } from 'node:crypto';
const m1 = process.env.M1_E2E_URL || 'http://m1-identidad-acceso:3001';

export async function request(url, expectedStatus, { method = 'GET', body, token, headers = {} } = {}) {
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });

  if (response.status !== expectedStatus) {
    const error = await response.json().catch(() => null);
    assert.equal(response.status, expectedStatus, `${method} ${url} (${error?.code || 'sin código'})`);
  }
  if (response.status === 204) return;
  return response.json();
}

export async function loginNewUser(rol) {
  const credentials = {
    email: `m4-e2e-${randomUUID()}@example.com`,
    password: 'M4-Prueba-e2e!',
  };

  await request(`${m1}/auth/registrar-usuario`, 201, {
    method: 'POST',
    body: {
      ...credentials,
      nombre: rol === 'CONDUCTOR' ? 'Conductor' : 'Pasajero',
      apellido: 'Prueba',
      dni: String(randomInt(10_000_000, 100_000_000)),
      telefono: '3794222222',
      rol,
    },
  });

  const { token, usuario } = await request(`${m1}/auth/iniciar-sesion`, 200, {
    method: 'POST',
    body: credentials,
  });
  assert.ok(typeof token === 'string' && token.length > 0);
  assert.ok(Number.isInteger(usuario.id) && usuario.id > 0);
  assert.equal(usuario.rol, rol);
  return { token, usuario };
}

