import type {
  CustomerProfile,
  AccountStatusResponse,
  CustomerTripsResponse,
  CreateCustomerDTO,
  Preferences,
} from './types';

// In development, Vite proxies /api → http://localhost:3000
// In production (Docker), nginx proxies /api → http://api:3000
const BASE = '/api/v1/customers';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  listCustomers: () =>
    request<CustomerProfile[]>(''),

  createCustomer: (dto: CreateCustomerDTO) =>
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
