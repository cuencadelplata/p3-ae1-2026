import { test, expect, type Page, type APIRequestContext } from '@playwright/test';

// ─── Helpers ────────────────────────────────────────────────────────────────

const API = '/api/v1/customers';
const M1_TOKEN = '/api/__stubs/m1/auth/token-de-prueba';

/** userId único por test para no chocar con perfiles de corridas anteriores */
let nextUserId = 100_000 + (Date.now() % 800_000);
function uniqueUserId() {
  return nextUserId++;
}

/** Pide un token de prueba al stub de M1 */
async function getToken(request: APIRequestContext, userId: number): Promise<string> {
  const res = await request.post(M1_TOKEN, { data: { userId, role: 'CLIENTE' } });
  expect(res.ok()).toBeTruthy();
  return ((await res.json()) as { token: string }).token;
}

/** Deja el token como sesión activa del front (equivale a venir redirigido por M1) */
async function useSession(page: Page, token: string) {
  await page.addInitScript((t) => sessionStorage.setItem('m2_token', t), token);
}

/** Crea un perfil vía API y abre su detalle con la sesión activa */
async function openFreshProfile(page: Page, request: APIRequestContext): Promise<string> {
  const token = await getToken(request, uniqueUserId());
  const res = await request.post(API, {
    headers: { Authorization: `Bearer ${token}` },
    data: { preferences: { preferredVehicleType: 'moto', notificationChannel: 'push' } },
  });
  expect(res.status()).toBe(201);
  const { customerId } = (await res.json()) as { customerId: string };

  await useSession(page, token);
  await page.goto(`/customers/${customerId}`);
  return customerId;
}

/** Abre un escenario demo desde el index y espera el detalle del perfil */
async function openDemo(page: Page, name: 'Perfil habilitado' | 'Perfil inhabilitado') {
  await page.goto('/');
  await page.getByRole('button', { name: new RegExp(name) }).click();
  await page.waitForURL(/\/customers\/cust_[0-9a-f]+/);
}

// ─── Suite ──────────────────────────────────────────────────────────────────

test.describe('M2 Customers E2E', () => {

  // ── RF-2.1: Perfil de cliente ──────────────────────────────────────────────
  test.describe('RF-2.1 - Customer profile', () => {

    test('index shows the two demo scenarios', async ({ page }) => {
      await page.goto('/');
      await expect(page.getByRole('heading', { name: /Perfil de Cliente/ })).toBeVisible();
      await expect(page.getByRole('button', { name: /Perfil habilitado/ })).toBeVisible();
      await expect(page.getByRole('button', { name: /Perfil inhabilitado/ })).toBeVisible();
    });

    test('demo scenario lands on the profile detail page', async ({ page }) => {
      await openDemo(page, 'Perfil habilitado');

      await expect(page.getByRole('heading', { name: 'Usuario #12' })).toBeVisible();
      await expect(page.getByText(/^cust_[0-9a-f]+$/)).toBeVisible();
    });

    test('user without profile is sent to onboarding and creates it', async ({ page, request }) => {
      const token = await getToken(request, uniqueUserId());
      await useSession(page, token);

      await page.goto('/');
      await page.waitForURL('/onboarding');

      await page.getByLabel('Vehículo preferido').selectOption('moto');
      await page.getByLabel('Canal de notificaciones').selectOption('push');
      await page.getByRole('button', { name: 'Crear perfil' }).click();

      await page.waitForURL(/\/customers\/cust_[0-9a-f]+/);
      await expect(page.getByLabel('Preferred vehicle')).toHaveValue('moto');
      await expect(page.getByLabel('Notification channel')).toHaveValue('push');
    });

    test('onboarding without a token redirects to index', async ({ page }) => {
      await page.goto('/onboarding');
      await page.waitForURL('/');
    });

    test('user with profile is sent straight to the detail from index', async ({ page, request }) => {
      const customerId = await openFreshProfile(page, request);

      await page.goto('/');
      await page.waitForURL(`/customers/${customerId}`);
    });

    test('creating a second profile for the same user returns 409', async ({ request }) => {
      const token = await getToken(request, uniqueUserId());
      const headers = { Authorization: `Bearer ${token}` };

      expect((await request.post(API, { headers, data: {} })).status()).toBe(201);
      const second = await request.post(API, { headers, data: {} });

      expect(second.status()).toBe(409);
      expect(((await second.json()) as { error: string }).error).toBe('ProfileAlreadyExists');
    });

    test('updates customer preferences', async ({ page, request }) => {
      await openFreshProfile(page, request);

      await page.getByLabel('Preferred vehicle').selectOption('auto');
      await page.getByLabel('Notification channel').selectOption('email');
      await page.getByRole('button', { name: 'Save preferences' }).click();

      await expect(page.getByText('✓ Saved')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Save preferences' })).toBeDisabled();

      // Persistió: tras recargar siguen los valores nuevos
      await page.reload();
      await expect(page.getByLabel('Preferred vehicle')).toHaveValue('auto');
      await expect(page.getByLabel('Notification channel')).toHaveValue('email');
    });

    test('save preferences button is disabled when nothing changed', async ({ page, request }) => {
      await openFreshProfile(page, request);

      await expect(page.getByRole('button', { name: 'Save preferences' })).toBeDisabled();
    });
  });

  // ── RF-2.5: Estado de cuenta ───────────────────────────────────────────────
  test.describe('RF-2.5 - Account status', () => {

    test('enabled profile shows ACTIVO status', async ({ page }) => {
      await openDemo(page, 'Perfil habilitado');

      await page.getByRole('button', { name: 'Estado de cuenta' }).click();

      await expect(page.getByRole('heading', { name: 'Estado de cuenta' })).toBeVisible();
      await expect(page.locator('.card .badge', { hasText: 'ACTIVO' })).toBeVisible();
    });

    test('profile with penalties is blocked automatically', async ({ page }) => {
      await openDemo(page, 'Perfil inhabilitado');

      await page.getByRole('button', { name: 'Estado de cuenta' }).click();

      await expect(page.locator('.card .badge', { hasText: 'BLOQUEADO_PERMANENTE' })).toBeVisible();
      await expect(page.getByText('Automático (penalizaciones)')).toBeVisible();
    });
  });

  // ── RF-2.3: Historial de viajes ────────────────────────────────────────────
  test.describe('RF-2.3 - Trip history', () => {

    test('shows trip history with origin, destination and fare', async ({ page }) => {
      await openDemo(page, 'Perfil habilitado');

      await page.getByRole('button', { name: 'Viajes' }).click();

      await expect(page.getByText(/2 viajes/)).toBeVisible();
      await expect(page.getByText('Av. Colón 1200, Córdoba → Av. General Paz 250, Córdoba')).toBeVisible();
      await expect(page.getByText('$1,850').or(page.getByText('$1.850'))).toBeVisible();
    });

    test('user without trips sees the empty state', async ({ page, request }) => {
      await openFreshProfile(page, request);

      await page.getByRole('button', { name: 'Viajes' }).click();

      await expect(page.getByText('No se encontraron viajes.')).toBeVisible();
    });
  });

  // ── Navegación y errores ───────────────────────────────────────────────────
  test.describe('Navigation', () => {

    test('shows an error for an unknown customer id', async ({ page, request }) => {
      await useSession(page, await getToken(request, uniqueUserId()));

      await page.goto('/customers/cust_nonexistent000');

      await expect(page.getByText(/^Error:/)).toBeVisible();
    });

    test('detail page links back to the index', async ({ page, request }) => {
      await openFreshProfile(page, request);

      await expect(page.getByRole('link', { name: /← Inicio/ })).toHaveAttribute('href', '/');
    });
  });
});
