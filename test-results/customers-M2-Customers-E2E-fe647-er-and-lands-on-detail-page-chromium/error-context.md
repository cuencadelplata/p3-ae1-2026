# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: customers.spec.ts >> M2 Customers E2E >> RF-2.1 - Customer profile >> creates a new customer and lands on detail page
- Location: tests/e2e/customers.spec.ts:33:9

# Error details

```
Error: page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:5173/new
Call log:
  - navigating to "http://localhost:5173/new", waiting until "load"

```

# Test source

```ts
  1   | import { test, expect, type Page } from '@playwright/test';
  2   | 
  3   | // ─── Helpers ────────────────────────────────────────────────────────────────
  4   | 
  5   | /** Genera un email único para no chocar con registros anteriores */
  6   | function uniqueEmail() {
  7   |   return `e2e.${Date.now()}@test.com`;
  8   | }
  9   | 
  10  | /** Crea un cliente desde la UI y devuelve su ID extraído de la URL */
  11  | async function createCustomer(page: Page, email: string): Promise<string> {
> 12  |   await page.goto('/new');
      |              ^ Error: page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:5173/new
  13  |   await page.getByLabel('Name').fill('E2E Test User');
  14  |   await page.getByRole('textbox', { name: 'Email' }).fill(email);
  15  |   await page.getByLabel('Phone').fill('+5493510000000');
  16  |   await page.getByRole('combobox', { name: 'Preferred vehicle' }).selectOption('moto');
  17  |   await page.getByRole('combobox', { name: 'Notification channel' }).selectOption('push');
  18  |   await page.getByRole('button', { name: 'Create Customer' }).click();
  19  | 
  20  |   // Redirige a /customers/:id tras crear
  21  |   await page.waitForURL(/\/customers\/.+/);
  22  |   const url = page.url();
  23  |   return url.split('/customers/')[1];
  24  | }
  25  | 
  26  | // ─── Suite ──────────────────────────────────────────────────────────────────
  27  | 
  28  | test.describe('M2 Customers E2E', () => {
  29  | 
  30  |   // ── RF-2.1: Crear cliente ──────────────────────────────────────────────────
  31  |   test.describe('RF-2.1 - Customer profile', () => {
  32  | 
  33  |     test('creates a new customer and lands on detail page', async ({ page }) => {
  34  |       const email = uniqueEmail();
  35  |       const id = await createCustomer(page, email);
  36  | 
  37  |       // Debe mostrar el nombre en el header
  38  |       await expect(page.getByRole('heading', { name: 'E2E Test User' })).toBeVisible();
  39  | 
  40  |       // El ID en la URL debe ser un customerId válido
  41  |       expect(id).toMatch(/^cust_[0-9a-f]+$/);
  42  |     });
  43  | 
  44  |     test('shows validation error for invalid email', async ({ page }) => {
  45  |       await page.goto('/new');
  46  |       await page.getByLabel('Name').fill('Test User');
  47  |       await page.getByRole('textbox', { name: 'Email' }).fill('not-an-email');
  48  |       await page.getByLabel('Phone').fill('+5493510000000');
  49  |       await page.getByRole('button', { name: 'Create Customer' }).click();
  50  | 
  51  |       // El browser bloquea el submit por el input[type=email] — el campo queda inválido
  52  |       await expect(page).toHaveURL('/new');
  53  |     });
  54  | 
  55  |     test('shows 409 error when email is already registered', async ({ page }) => {
  56  |       const email = uniqueEmail();
  57  |       // Primer registro
  58  |       await createCustomer(page, email);
  59  | 
  60  |       // Segundo registro con el mismo email
  61  |       await page.goto('/new');
  62  |       await page.getByLabel('Name').fill('Duplicate User');
  63  |       await page.getByRole('textbox', { name: 'Email' }).fill(email);
  64  |       await page.getByLabel('Phone').fill('+5493510000001');
  65  |       await page.getByRole('button', { name: 'Create Customer' }).click();
  66  | 
  67  |       await expect(page.getByText(/EmailAlreadyExists|ya existe/i)).toBeVisible();
  68  |     });
  69  | 
  70  |     test('lists customers including the newly created one', async ({ page }) => {
  71  |       const email = uniqueEmail();
  72  |       await createCustomer(page, email);
  73  | 
  74  |       await page.goto('/');
  75  |       await expect(page.getByText(email)).toBeVisible();
  76  |     });
  77  | 
  78  |     test('navigates to customer detail from list', async ({ page }) => {
  79  |       const email = uniqueEmail();
  80  |       await createCustomer(page, email);
  81  | 
  82  |       await page.goto('/');
  83  |       const row = page.getByRole('row').filter({ hasText: email });
  84  |       await row.getByRole('link', { name: /View/i }).click();
  85  | 
  86  |       await expect(page.getByRole('heading', { name: 'E2E Test User' })).toBeVisible();
  87  |     });
  88  | 
  89  |     test('updates customer preferences', async ({ page }) => {
  90  |       const email = uniqueEmail();
  91  |       const id = await createCustomer(page, email);
  92  |       await page.goto(`/customers/${id}`);
  93  | 
  94  |       // Cambiar preferencias
  95  |       await page.getByRole('combobox', { name: 'Preferred vehicle' }).selectOption('auto');
  96  |       await page.getByRole('combobox', { name: 'Notification channel' }).selectOption('email');
  97  |       await page.getByRole('button', { name: 'Save preferences' }).click();
  98  | 
  99  |       // Feedback de guardado
  100 |       await expect(page.getByText('✓ Saved')).toBeVisible();
  101 |     });
  102 | 
  103 |     test('save preferences button is disabled when nothing changed', async ({ page }) => {
  104 |       const email = uniqueEmail();
  105 |       const id = await createCustomer(page, email);
  106 |       await page.goto(`/customers/${id}`);
  107 | 
  108 |       // Sin tocar nada, el botón debe estar deshabilitado
  109 |       await expect(page.getByRole('button', { name: 'Save preferences' })).toBeDisabled();
  110 |     });
  111 |   });
  112 | 
```