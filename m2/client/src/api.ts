import type {
  CustomerProfile,
  AccountStatusResponse,
  CustomerTripsResponse,
  CreateCustomerDTO,
  Preferences,
} from './types';

// En desarrollo, Vite proxea /api → http://localhost:3000
// En producción (Docker), nginx proxea /api → http://api:3000
const BASE = '/api/v1/customers';
const M1_BASE = '/api/__stubs/m1';

// ─── Token de sesión ────────────────────────────────────────────────────────
// El token JWT lo emite el stub de M1. Lo guardamos en memoria (y en sessionStorage
// para sobrevivir recargas) y lo inyectamos en cada request a la API protegida.

let activeToken: string | null = sessionStorage.getItem('m2_token');

export function setToken(token: string | null): void {
  activeToken = token;
  if (token) sessionStorage.setItem('m2_token', token);
  else sessionStorage.removeItem('m2_token');
}

export function getToken(): string | null {
  return activeToken;
}

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (activeToken) headers.Authorization = `Bearer ${activeToken}`;
  return headers;
}

/** Error de API que preserva el status HTTP para que el caller distinga 404, 503, etc. */
export class ApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: authHeaders(),
    ...options,
    // Si options trae headers propios, los combinamos con los de auth
    ...(options?.headers ? { headers: { ...authHeaders(), ...options.headers } } : {}),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body.message ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

// ─── M1 (stub de autenticación) ───────────────────────────────────────────────

/**
 * Pide un token de prueba al stub de M1 para un userId y rol dados.
 * Solo funciona con STUBS_ENABLED=true (entorno de desarrollo/demo).
 */
export async function getTestToken(userId: number, role = 'CLIENTE'): Promise<string> {
  const res = await fetch(`${M1_BASE}/auth/token-de-prueba`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, role }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message ?? `No se pudo obtener el token de prueba (HTTP ${res.status})`);
  }
  const data = (await res.json()) as { token: string };
  return data.token;
}

// ─── API de clientes (M2) ──────────────────────────────────────────────────────

export const api = {
  getMe: () =>
    request<CustomerProfile>('/me'),

  createCustomer: (dto: CreateCustomerDTO = {}) =>
    request<CustomerProfile>('', {
      method: 'POST',
      body: JSON.stringify(dto),
    }),

  getCustomer: (id: string) =>
    request<CustomerProfile>(`/${id}`),

  updatePreferences: (id: string, preferences: Preferences) =>
    request<CustomerProfile>(`/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ preferences }),
    }),

  getAccountStatus: (id: string) =>
    request<AccountStatusResponse>(`/${id}/status`),

  getTrips: (id: string) =>
    request<CustomerTripsResponse>(`/${id}/trips`),
};

// ─── Flujo real: token desde la URL ─────────────────────────────────────────────

/**
 * Flujo de producción: M1 redirige al front con el token en la URL
 * (ej. https://m2.app/?token=<jwt>). Esta función lo lee, lo activa como sesión
 * y limpia la URL para no dejar el token expuesto en la barra de direcciones.
 *
 * Devuelve true si encontró y activó un token nuevo desde la URL.
 */
export function initTokenFromUrl(): boolean {
  const params = new URLSearchParams(window.location.search);
  const token = params.get('token');
  if (!token) return false;

  setToken(token);

  // Limpiar el token de la URL (deja el resto del path/params intactos)
  params.delete('token');
  const query = params.toString();
  const cleanUrl = window.location.pathname + (query ? `?${query}` : '');
  window.history.replaceState({}, '', cleanUrl);

  return true;
}

/**
 * Resuelve el perfil del usuario autenticado (token ya activo).
 *  - Si existe → devuelve { profile }
 *  - Si no existe (404) → devuelve { profile: null } para que el front muestre el alta
 *
 * Lanza si no hay token activo o si la API falla por otra razón (ej. 503).
 */
export async function resolverMiPerfil(): Promise<{ profile: CustomerProfile | null }> {
  if (!activeToken) throw new Error('No hay un token activo');
  try {
    const profile = await api.getMe();
    return { profile };
  } catch (err) {
    // 404 → el usuario todavía no tiene perfil (hay que crearlo)
    if (err instanceof ApiError && err.status === 404) {
      return { profile: null };
    }
    throw err; // 401, 503, etc. se propagan
  }
}

// ─── Flujo de demostración (botones del index) ──────────────────────────────────

/**
 * Atajo SOLO para la demo (no hay integración real con M1 todavía):
 * genera un token de prueba contra el stub de M1 y crea/recupera el perfil.
 *
 * userId 12 → sin penalizaciones (perfil habilitado / ACTIVO)
 * userId 14 → 3 penalizaciones vigentes (perfil inhabilitado / BLOQUEADO al ver estado)
 */
export async function prepararPerfilDePrueba(userId: number): Promise<CustomerProfile> {
  const token = await getTestToken(userId, 'CLIENTE');
  setToken(token);

  try {
    return await api.getMe();
  } catch (err) {
    // Solo el 404 significa "todavía no tiene perfil"; cualquier otro error se propaga
    if (!(err instanceof ApiError && err.status === 404)) throw err;
    return await api.createCustomer({
      preferences: { preferredVehicleType: 'auto', notificationChannel: 'email' },
    });
  }
}
