import { test, expect, type Page } from '@playwright/test';

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Genera un email único para no chocar con registros anteriores */
function uniqueEmail() {
  return `e2e.${Date.now()}@test.com`;
}

/** Crea un cliente desde la UI y devuelve su ID extraído de la URL */
async function createCustomer(page: Page, email: string): Promise<string> {
  await page.goto('/new');
  await page.getByLabel('Name').fill('E2E Test User');
  await page.getByRole('textbox', { name: 'Email' }).fill(email);
  await page.getByLabel('Phone').fill('+5493510000000');
  await page.getByRole('combobox', { name: 'Preferred vehicle' }).selectOption('moto');
  await page.getByRole('combobox', { name: 'Notification channel' }).selectOption('push');
  await page.getByRole('button', { name: 'Create Customer' }).click();

  // Redirige a /customers/:id tras crear
  await page.waitForURL(/\/customers\/.+/);
  const url = page.url();
  return url.split('/customers/')[1];
}

// ─── Suite ──────────────────────────────────────────────────────────────────

test.describe('M2 Customers E2E', () => {

  // ── RF-2.1: Crear cliente ──────────────────────────────────────────────────
  test.describe('RF-2.1 - Customer profile', () => {

    test('creates a new customer and lands on detail page', async ({ page }) => {
      const email = uniqueEmail();
      const id = await createCustomer(page, email);

      // Debe mostrar el nombre en el header
      await expect(page.getByRole('heading', { name: 'E2E Test User' })).toBeVisible();

      // El ID en la URL debe ser un customerId válido
      expect(id).toMatch(/^cust_[0-9a-f]+$/);
    });

    test('shows validation error for invalid email', async ({ page }) => {
      await page.goto('/new');
      await page.getByLabel('Name').fill('Test User');
      await page.getByRole('textbox', { name: 'Email' }).fill('not-an-email');
      await page.getByLabel('Phone').fill('+5493510000000');
      await page.getByRole('button', { name: 'Create Customer' }).click();

      // El browser bloquea el submit por el input[type=email] — el campo queda inválido
      await expect(page).toHaveURL('/new');
    });

    test('shows 409 error when email is already registered', async ({ page }) => {
      const email = uniqueEmail();
      // Primer registro
      await createCustomer(page, email);

      // Segundo registro con el mismo email
      await page.goto('/new');
      await page.getByLabel('Name').fill('Duplicate User');
      await page.getByRole('textbox', { name: 'Email' }).fill(email);
      await page.getByLabel('Phone').fill('+5493510000001');
      await page.getByRole('button', { name: 'Create Customer' }).click();

      await expect(page.getByText(/EmailAlreadyExists|ya existe/i)).toBeVisible();
    });

    test('lists customers including the newly created one', async ({ page }) => {
      const email = uniqueEmail();
      await createCustomer(page, email);

      await page.goto('/');
      await expect(page.getByText(email)).toBeVisible();
    });

    test('navigates to customer detail from list', async ({ page }) => {
      const email = uniqueEmail();
      await createCustomer(page, email);

      await page.goto('/');
      const row = page.getByRole('row').filter({ hasText: email });
      await row.getByRole('link', { name: /View/i }).click();

      await expect(page.getByRole('heading', { name: 'E2E Test User' })).toBeVisible();
    });

    test('updates customer preferences', async ({ page }) => {
      const email = uniqueEmail();
      const id = await createCustomer(page, email);
      await page.goto(`/customers/${id}`);

      // Cambiar preferencias
      await page.getByRole('combobox', { name: 'Preferred vehicle' }).selectOption('auto');
      await page.getByRole('combobox', { name: 'Notification channel' }).selectOption('email');
      await page.getByRole('button', { name: 'Save preferences' }).click();

      // Feedback de guardado
      await expect(page.getByText('✓ Saved')).toBeVisible();
    });

    test('save preferences button is disabled when nothing changed', async ({ page }) => {
      const email = uniqueEmail();
      const id = await createCustomer(page, email);
      await page.goto(`/customers/${id}`);

      // Sin tocar nada, el botón debe estar deshabilitado
      await expect(page.getByRole('button', { name: 'Save preferences' })).toBeDisabled();
    });
  });

  // ── RF-2.5: Estado de cuenta ───────────────────────────────────────────────
  test.describe('RF-2.5 - Account status', () => {

    test('shows account status for an existing customer', async ({ page }) => {
      const email = uniqueEmail();
      const id = await createCustomer(page, email);
      await page.goto(`/customers/${id}`);

      await page.getByRole('button', { name: 'Status' }).click();

      await expect(page.getByText('Account Status')).toBeVisible();
      // Un cliente recién creado debe estar ACTIVO
      await expect(page.getByText('ACTIVO').first()).toBeVisible();
      await expect(page.getByText(/Perfil verificado/i)).toBeVisible();
    });
  });

  // ── RF-2.3: Historial de viajes ────────────────────────────────────────────
  test.describe('RF-2.3 - Trip history', () => {

    test('shows trip history for an existing customer', async ({ page }) => {
      const email = uniqueEmail();
      const id = await createCustomer(page, email);
      await page.goto(`/customers/${id}`);

      await page.getByRole('button', { name: 'Trips' }).click();

      // El servicio retorna datos reales de M6 o el fallback de demo
      await expect(page.getByText(/trip found|trips found/i)).toBeVisible();
    });

    test('displays trip details with origin, destination and fare', async ({ page }) => {
      const email = uniqueEmail();
      const id = await createCustomer(page, email);
      await page.goto(`/customers/${id}`);

      await page.getByRole('button', { name: 'Trips' }).click();

      // Al menos un viaje con flecha entre origen y destino
      await expect(page.getByText(/→/).first()).toBeVisible();
      // Al menos un precio visible
      await expect(page.getByText(/\$[\d,.]+/).first()).toBeVisible();
    });
  });

  // ── Navegación y 404 ──────────────────────────────────────────────────────
  test.describe('Navigation', () => {

    test('shows not found state for unknown customer id', async ({ page }) => {
      await page.goto('/customers/cust_nonexistent000');
      await expect(page.getByText(/Error|not found/i)).toBeVisible();
    });

    test('cancel button on create form returns to list', async ({ page }) => {
      await page.goto('/new');
      await page.getByRole('button', { name: 'Cancel' }).click();
      await expect(page).toHaveURL('/');
    });

    test('back link on detail page returns to list', async ({ page }) => {
      const email = uniqueEmail();
      const id = await createCustomer(page, email);
      await page.goto(`/customers/${id}`);

      await page.getByRole('link', { name: /← Customers/i }).click();
      await expect(page).toHaveURL('/');
    });
  });
});
