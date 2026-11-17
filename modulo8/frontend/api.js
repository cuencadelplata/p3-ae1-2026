import { ApiError } from './errors.js';

let bearerToken = '';

export function setBearerToken(token) {
  bearerToken = String(token || '').trim().replace(/^Bearer\s+/i, '');
}

export function hasBearerToken() { return bearerToken.length > 0; }

export async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (bearerToken) headers.set('Authorization', `Bearer ${bearerToken}`);
  if (options.body && typeof options.body !== 'string') headers.set('Content-Type', 'application/json');
  const response = await fetch(path, {
    ...options,
    headers,
    body: options.body && typeof options.body !== 'string' ? JSON.stringify(options.body) : options.body,
    cache: 'no-store',
  });
  if (options.raw && response.ok) return response;
  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('json') ? await response.json().catch(() => null) : await response.text().catch(() => '');
  if (!response.ok) {
    const detail = data?.error?.message || data?.message || `La solicitud devolvió HTTP ${response.status}.`;
    throw new ApiError(response.status, detail);
  }
  return { data, response };
}
