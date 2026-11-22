// Utilidades compartidas por los scripts de k6 de M2.
import http from 'k6/http';

export const BASE = __ENV.M2_URL || 'http://localhost:3000';
export const API_KEY = __ENV.INTERNAL_API_KEY || 'internal-dev';
// Con M1_URL (stack integrado movilidad-urbana) los usuarios y tokens salen del M1 real.
// Sin M1_URL (stack propio de M2) se usa el stub de M1, como siempre.
export const M1_URL = (__ENV.M1_URL || '').replace(/\/+$/, '');

// userIds reservados para las pruebas, separados de los de demo (12 y 13).
export const FIRST_USER_ID = 9001;

const JSON_HEADERS = { 'Content-Type': 'application/json' };
const SETUP = { headers: JSON_HEADERS, tags: { name: 'setup' } };

// Registra un cliente nuevo en el M1 real e inicia sesión. Devuelve su userId (lo asigna M1) y su token.
// Email, DNI y teléfono únicos por corrida para no chocar con usuarios de corridas anteriores.
function realUser(runId, i) {
  const n = `${runId}${String(i).padStart(2, '0')}`; // 8 dígitos
  const email = `m2.k6.${n}@example.com`;
  const password = 'Prueba-K6-2026!';
  http.post(`${M1_URL}/auth/registrar-usuario`, JSON.stringify({
    nombre: 'ClienteK6', apellido: `M2-${n}`, dni: n, telefono: `+54 9 11 ${n}`,
    email, password, rol: 'CLIENTE',
  }), SETUP);

  const login = http.post(`${M1_URL}/auth/iniciar-sesion`, JSON.stringify({ email, password }), SETUP);
  const body = login.json() || {};
  const token = body.token || body.accessToken || (body.data || {}).token;
  if (!token) throw new Error(`M1 no devolvió token para ${email}: HTTP ${login.status} ${login.body}`);

  const me = http.get(`${M1_URL}/auth/me`, { ...SETUP, headers: { Authorization: `Bearer ${token}` } }).json() || {};
  const userId = Number(me.userId || me.id || (me.data || {}).userId);
  if (!userId) throw new Error(`M1 no devolvió el userId de ${email}`);
  return { userId, token };
}

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
  if (M1_URL) {
    const runId = String(Date.now()).slice(-6);
    for (let i = 0; i < count; i++) {
      const user = realUser(runId, i);
      ensureProfile(user.token);
      users.push(user);
    }
    return users;
  }
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
