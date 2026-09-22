# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: customers.spec.ts >> M2 Customers E2E >> Navigation >> cancel button on create form returns to list
- Location: tests/e2e/customers.spec.ts:166:9

# Error details

```
Error: page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:5173/new
Call log:
  - navigating to "http://localhost:5173/new", waiting until "load"

```

# Test source

```ts
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
  113 |   // ── RF-2.5: Estado de cuenta ───────────────────────────────────────────────
  114 |   test.describe('RF-2.5 - Account status', () => {
  115 | 
  116 |     test('shows account status for an existing customer', async ({ page }) => {
  117 |       const email = uniqueEmail();
  118 |       const id = await createCustomer(page, email);
  119 |       await page.goto(`/customers/${id}`);
  120 | 
  121 |       await page.getByRole('button', { name: 'Status' }).click();
  122 | 
  123 |       await expect(page.getByText('Account Status')).toBeVisible();
  124 |       // Un cliente recién creado debe estar ACTIVO
  125 |       await expect(page.getByText('ACTIVO').first()).toBeVisible();
  126 |       await expect(page.getByText(/Perfil verificado/i)).toBeVisible();
  127 |     });
  128 |   });
  129 | 
  130 |   // ── RF-2.3: Historial de viajes ────────────────────────────────────────────
  131 |   test.describe('RF-2.3 - Trip history', () => {
  132 | 
  133 |     test('shows trip history for an existing customer', async ({ page }) => {
  134 |       const email = uniqueEmail();
  135 |       const id = await createCustomer(page, email);
  136 |       await page.goto(`/customers/${id}`);
  137 | 
  138 |       await page.getByRole('button', { name: 'Trips' }).click();
  139 | 
  140 |       // El servicio retorna datos reales de M6 o el fallback de demo
  141 |       await expect(page.getByText(/trip found|trips found/i)).toBeVisible();
  142 |     });
  143 | 
  144 |     test('displays trip details with origin, destination and fare', async ({ page }) => {
  145 |       const email = uniqueEmail();
  146 |       const id = await createCustomer(page, email);
  147 |       await page.goto(`/customers/${id}`);
  148 | 
  149 |       await page.getByRole('button', { name: 'Trips' }).click();
  150 | 
  151 |       // Al menos un viaje con flecha entre origen y destino
  152 |       await expect(page.getByText(/→/).first()).toBeVisible();
  153 |       // Al menos un precio visible
  154 |       await expect(page.getByText(/\$[\d,.]+/).first()).toBeVisible();
  155 |     });
  156 |   });
  157 | 
  158 |   // ── Navegación y 404 ──────────────────────────────────────────────────────
  159 |   test.describe('Navigation', () => {
  160 | 
  161 |     test('shows not found state for unknown customer id', async ({ page }) => {
  162 |       await page.goto('/customers/cust_nonexistent000');
  163 |       await expect(page.getByText(/Error|not found/i)).toBeVisible();
  164 |     });
  165 | 
  166 |     test('cancel button on create form returns to list', async ({ page }) => {
> 167 |       await page.goto('/new');
      |                  ^ Error: page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:5173/new
  168 |       await page.getByRole('button', { name: 'Cancel' }).click();
  169 |       await expect(page).toHaveURL('/');
  170 |     });
  171 | 
  172 |     test('back link on detail page returns to list', async ({ page }) => {
  173 |       const email = uniqueEmail();
  174 |       const id = await createCustomer(page, email);
  175 |       await page.goto(`/customers/${id}`);
  176 | 
  177 |       await page.getByRole('link', { name: /← Customers/i }).click();
  178 |       await expect(page).toHaveURL('/');
  179 |     });
  180 |   });
  181 | });
  182 | 
```