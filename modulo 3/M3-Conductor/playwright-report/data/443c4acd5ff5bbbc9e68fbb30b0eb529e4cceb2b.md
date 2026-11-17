# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: frontend.spec.js >> M3 - Frontend Conductor & Valoraciones (E2E Test Runner) >> debe registrar una nueva valoración con POST /conductor/valoraciones
- Location: tests\e2e\frontend.spec.js:168:3

# Error details

```
Error: page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:3000/
Call log:
  - navigating to "http://localhost:3000/", waiting until "load"

```

# Test source

```ts
  1   | const { test, expect } = require('@playwright/test');
  2   | 
  3   | test.describe('M3 - Frontend Conductor & Valoraciones (E2E Test Runner)', () => {
  4   | 
  5   |   test.beforeEach(async ({ page }) => {
  6   |     // Navegar a la raíz de la aplicación web
> 7   |     await page.goto('/');
      |                ^ Error: page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:3000/
  8   |   });
  9   | 
  10  |   test('debe cargar la página con el título, encabezado y controles principales', async ({ page }) => {
  11  |     // Título de la pestaña
  12  |     await expect(page).toHaveTitle(/M3 - Conductor & Valoraciones/i);
  13  | 
  14  |     // Encabezado principal
  15  |     const heading = page.locator('header h1');
  16  |     await expect(heading).toBeVisible();
  17  |     await expect(heading).toContainText('M3: Conductores & Valoraciones');
  18  | 
  19  |     // Botones de cambio de pestaña
  20  |     await expect(page.locator('#tabTesterBtn')).toBeVisible();
  21  |     await expect(page.locator('#tabSwaggerBtn')).toBeVisible();
  22  | 
  23  |     // Input de Base URL
  24  |     const baseUrlInput = page.locator('#baseUrlInput');
  25  |     await expect(baseUrlInput).toBeVisible();
  26  |     await expect(baseUrlInput).toHaveValue(/http:\/\/localhost:(4000|3000|5000)\/api/);
  27  | 
  28  |     // Contenedores del Test Runner visibles por defecto
  29  |     await expect(page.locator('#testerView')).toBeVisible();
  30  |     await expect(page.locator('#swaggerView')).toBeHidden();
  31  |   });
  32  | 
  33  |   test('debe verificar la conectividad con el servidor mediante el botón de Ping', async ({ page }) => {
  34  |     const pingBtn = page.locator('button[title="Comprobar conectividad"]');
  35  |     const badge = page.locator('#serverStatusBadge');
  36  | 
  37  |     await expect(pingBtn).toBeVisible();
  38  |     await pingBtn.click();
  39  | 
  40  |     // El badge debe pasar a verde (bg-emerald-500) con título indicando éxito
  41  |     await expect(badge).toHaveClass(/bg-emerald-500/);
  42  |     await expect(badge).toHaveAttribute('title', 'Servidor responde correctamente');
  43  |   });
  44  | 
  45  |   test('debe listar los conductores con GET /conductores', async ({ page }) => {
  46  |     // Seleccionar el endpoint de listar conductores
  47  |     await page.locator('#btn_get_conductores').click();
  48  | 
  49  |     // Validar insignia de método y endpoint
  50  |     await expect(page.locator('#reqMethodBadge')).toHaveText('GET');
  51  |     await expect(page.locator('#reqEndpointUrl')).toHaveText('/conductores');
  52  | 
  53  |     // Enviar petición
  54  |     await page.locator('#sendBtn').click();
  55  | 
  56  |     // Verificar respuesta HTTP 200 OK
  57  |     const statusBadge = page.locator('#statusBadge');
  58  |     await expect(statusBadge).toBeVisible();
  59  |     await expect(statusBadge).toContainText('200');
  60  | 
  61  |     // Verificar que la URL ejecutada corresponda al endpoint
  62  |     await expect(page.locator('#executedUrlText')).toContainText('/conductores');
  63  | 
  64  |     // Verificar que el cuerpo de respuesta contenga datos de conductores
  65  |     const jsonOutput = page.locator('#jsonOutput');
  66  |     await expect(jsonOutput).toBeVisible();
  67  |     await expect(jsonOutput).toContainText('cond_001');
  68  | 
  69  |     // Verificar que se haya registrado en el historial
  70  |     const historyList = page.locator('#historyList');
  71  |     await expect(historyList).toContainText('GET');
  72  |     await expect(historyList).toContainText('/conductores');
  73  |   });
  74  | 
  75  |   test('debe consultar un conductor por ID con GET /conductores/{id}', async ({ page }) => {
  76  |     // Seleccionar endpoint por ID
  77  |     await page.locator('#btn_get_conductor_id').click();
  78  | 
  79  |     await expect(page.locator('#reqMethodBadge')).toHaveText('GET');
  80  |     await expect(page.locator('#reqEndpointUrl')).toHaveText('/conductores/{id}');
  81  | 
  82  |     // El input del parámetro id debe existir
  83  |     const paramIdInput = page.locator('#param_id');
  84  |     await expect(paramIdInput).toBeVisible();
  85  | 
  86  |     // Completar con ID cond_001
  87  |     await paramIdInput.fill('cond_001');
  88  | 
  89  |     // Enviar petición
  90  |     await page.locator('#sendBtn').click();
  91  | 
  92  |     // Verificar respuesta 200 OK y datos correspondientes
  93  |     await expect(page.locator('#statusBadge')).toContainText('200');
  94  |     const jsonOutput = page.locator('#jsonOutput');
  95  |     await expect(jsonOutput).toContainText('cond_001');
  96  |     await expect(jsonOutput).toContainText('Corrientes');
  97  |   });
  98  | 
  99  |   test('debe mostrar error 404 al consultar un conductor inexistente', async ({ page }) => {
  100 |     await page.locator('#btn_get_conductor_id').click();
  101 | 
  102 |     const paramIdInput = page.locator('#param_id');
  103 |     await paramIdInput.fill('cond_no_existe_99999');
  104 | 
  105 |     await page.locator('#sendBtn').click();
  106 | 
  107 |     // El badge debe mostrar status 404
```