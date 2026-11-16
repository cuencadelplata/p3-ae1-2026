// Utilidades compartidas por los scripts de k6 de M2.
import http from 'k6/http';

export const BASE = __ENV.M2_URL || 'http://localhost:3000';
export const API_KEY = __ENV.INTERNAL_API_KEY || 'internal-dev';

// userIds reservados para las pruebas, separados de los de demo (12 y 13).
export const FIRST_USER_ID = 9001;

const JSON_HEADERS = { 'Content-Type': 'application/json' };

// Pide un JWT al stub de M1 (requiere STUBS_ENABLED=true, como en el compose).
export function tokenFor(userId) {
  const res = http.post(
    `${BASE}/__stubs/m1/auth/token-de-prueba`,
    JSON.stringify({ userId, role: 'CLIENTE' }),
    { headers: JSON_HEADERS, tags: { name: 'setup' } }
  );
  if (res.status !== 200) throw new Error(`No se pudo obtener token para ${userId}: HTTP ${res.status}`);
  return res.json('token');
}

// Crea el perfil con canal push. 201 = creado; 409 = ya existía de una corrida anterior.
export function ensureProfile(token) {
  const res = http.post(
    `${BASE}/v1/customers`,
    JSON.stringify({ preferences: { notificationChannel: 'push' } }),
    {
      headers: { ...JSON_HEADERS, Authorization: `Bearer ${token}` },
      tags: { name: 'setup' },
      // Sin esto, k6 cuenta el 409 como fallo en http_req_failed.
      responseCallback: http.expectedStatuses(201, 409),
    }
  );
  if (res.status !== 201 && res.status !== 409) {
    throw new Error(`No se pudo crear el perfil: HTTP ${res.status} ${res.body}`);
  }
}

export function prepareUsers(count) {
  const users = [];
  for (let i = 0; i < count; i++) {
    const userId = FIRST_USER_ID + i;
    const token = tokenFor(userId);
    ensureProfile(token);
    users.push({ userId, token });
  }
  return users;
}

export function withToken(token, name) {
  return { headers: { Authorization: `Bearer ${token}` }, tags: { name } };
}

export function withApiKey(name) {
  return { headers: { 'x-api-key': API_KEY }, tags: { name } };
}
