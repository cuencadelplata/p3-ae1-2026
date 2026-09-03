const { test, expect } = require('@playwright/test');

test.describe('M3 - Frontend Conductor & Valoraciones (E2E Test Runner)', () => {

  test.beforeEach(async ({ page }) => {
    // Navegar a la raíz de la aplicación web
    await page.goto('/');
  });

  test('debe cargar la página con el título, encabezado y controles principales', async ({ page }) => {
    // Título de la pestaña
    await expect(page).toHaveTitle(/M3 - Conductor & Valoraciones/i);

    // Encabezado principal
    const heading = page.locator('header h1');
    await expect(heading).toBeVisible();
    await expect(heading).toContainText('M3: Conductores & Valoraciones');

    // Botones de cambio de pestaña
    await expect(page.locator('#tabTesterBtn')).toBeVisible();
    await expect(page.locator('#tabSwaggerBtn')).toBeVisible();

    // Input de Base URL
    const baseUrlInput = page.locator('#baseUrlInput');
    await expect(baseUrlInput).toBeVisible();
    await expect(baseUrlInput).toHaveValue(/http:\/\/localhost:(4000|3000|5000)\/api/);

    // Contenedores del Test Runner visibles por defecto
    await expect(page.locator('#testerView')).toBeVisible();
    await expect(page.locator('#swaggerView')).toBeHidden();
  });

  test('debe verificar la conectividad con el servidor mediante el botón de Ping', async ({ page }) => {
    const pingBtn = page.locator('button[title="Comprobar conectividad"]');
    const badge = page.locator('#serverStatusBadge');

    await expect(pingBtn).toBeVisible();
    await pingBtn.click();

    // El badge debe pasar a verde (bg-emerald-500) con título indicando éxito
    await expect(badge).toHaveClass(/bg-emerald-500/);
    await expect(badge).toHaveAttribute('title', 'Servidor responde correctamente');
  });

  test('debe listar los conductores con GET /conductores', async ({ page }) => {
    // Seleccionar el endpoint de listar conductores
    await page.locator('#btn_get_conductores').click();

    // Validar insignia de método y endpoint
    await expect(page.locator('#reqMethodBadge')).toHaveText('GET');
    await expect(page.locator('#reqEndpointUrl')).toHaveText('/conductores');

    // Enviar petición
    await page.locator('#sendBtn').click();

    // Verificar respuesta HTTP 200 OK
    const statusBadge = page.locator('#statusBadge');
    await expect(statusBadge).toBeVisible();
    await expect(statusBadge).toContainText('200');

    // Verificar que la URL ejecutada corresponda al endpoint
    await expect(page.locator('#executedUrlText')).toContainText('/conductores');

    // Verificar que el cuerpo de respuesta contenga datos de conductores
    const jsonOutput = page.locator('#jsonOutput');
    await expect(jsonOutput).toBeVisible();
    await expect(jsonOutput).toContainText('cond_001');

    // Verificar que se haya registrado en el historial
    const historyList = page.locator('#historyList');
    await expect(historyList).toContainText('GET');
    await expect(historyList).toContainText('/conductores');
  });

  test('debe consultar un conductor por ID con GET /conductores/{id}', async ({ page }) => {
    // Seleccionar endpoint por ID
    await page.locator('#btn_get_conductor_id').click();

    await expect(page.locator('#reqMethodBadge')).toHaveText('GET');
    await expect(page.locator('#reqEndpointUrl')).toHaveText('/conductores/{id}');

    // El input del parámetro id debe existir
    const paramIdInput = page.locator('#param_id');
    await expect(paramIdInput).toBeVisible();

    // Completar con ID cond_001
    await paramIdInput.fill('cond_001');

    // Enviar petición
    await page.locator('#sendBtn').click();

    // Verificar respuesta 200 OK y datos correspondientes
    await expect(page.locator('#statusBadge')).toContainText('200');
    const jsonOutput = page.locator('#jsonOutput');
    await expect(jsonOutput).toContainText('cond_001');
    await expect(jsonOutput).toContainText('Corrientes');
  });

  test('debe mostrar error 404 al consultar un conductor inexistente', async ({ page }) => {
    await page.locator('#btn_get_conductor_id').click();

    const paramIdInput = page.locator('#param_id');
    await paramIdInput.fill('cond_no_existe_99999');

    await page.locator('#sendBtn').click();

    // El badge debe mostrar status 404
    const statusBadge = page.locator('#statusBadge');
    await expect(statusBadge).toContainText('404');

    // El cuerpo JSON debe contener el mensaje de no encontrado
    const jsonOutput = page.locator('#jsonOutput');
    await expect(jsonOutput).toContainText('no encontrado');
  });

  test('debe crear un nuevo conductor con POST /conductores/', async ({ page }) => {
    // Seleccionar endpoint de creación
    await page.locator('#btn_post_conductor').click();

    await expect(page.locator('#reqMethodBadge')).toHaveText('POST');
    await expect(page.locator('#bodySection')).toBeVisible();

    // Generar un usuarioID único para el test
    const testDriverId = `cond_test_${Date.now()}`;
    const payload = {
      usuarioID: testDriverId,
      ciudad: 'Resistencia',
      tipovehiculo: 'auto',
      licenciaId: 'lic_playwright_123',
      vehiculoId: 'veh_pw_999',
      habilitado: 'activo',
      estado_conexion: 'conectado'
    };

    // Escribir payload en el textarea
    await page.locator('#jsonBodyInput').fill(JSON.stringify(payload, null, 2));

    // Enviar petición
    await page.locator('#sendBtn').click();

    // Verificar respuesta 201 Created
    const statusBadge = page.locator('#statusBadge');
    await expect(statusBadge).toContainText('201');

    // Verificar que la respuesta contenga el ID creado
    const jsonOutput = page.locator('#jsonOutput');
    await expect(jsonOutput).toContainText(testDriverId);
    await expect(jsonOutput).toContainText('Resistencia');
  });

  test('debe consultar valoraciones con GET /conductor/valoraciones', async ({ page }) => {
    await page.locator('#btn_get_valoraciones').click();

    await expect(page.locator('#reqMethodBadge')).toHaveText('GET');
    await expect(page.locator('#reqEndpointUrl')).toHaveText('/conductor/valoraciones');

    const usuarioIdInput = page.locator('#param_usuarioId');
    await expect(usuarioIdInput).toBeVisible();
    await usuarioIdInput.fill('usr_9988');

    await page.locator('#sendBtn').click();

    const statusBadge = page.locator('#statusBadge');
    await expect(statusBadge).toContainText('200');
    await expect(page.locator('#executedUrlText')).toContainText('usuarioId=usr_9988');
  });

  test('debe registrar una nueva valoración con POST /conductor/valoraciones', async ({ page }) => {
    await page.locator('#btn_post_valoracion').click();

    await expect(page.locator('#reqMethodBadge')).toHaveText('POST');
    await expect(page.locator('#bodySection')).toBeVisible();

    const targetConductor = 'cond_001';
    await page.locator('#param_usuarioId').fill(targetConductor);

    const valoracionPayload = {
      usuarioId: 'pasajero_e2e',
      conductorId: targetConductor,
      valoracion: 5,
      comentario: 'Excelente servicio probado mediante Playwright E2E'
    };

    await page.locator('#jsonBodyInput').fill(JSON.stringify(valoracionPayload, null, 2));

    await page.locator('#sendBtn').click();

    // Verificar status 201
    const statusBadge = page.locator('#statusBadge');
    await expect(statusBadge).toContainText('201');

    // Verificar que el comentario y puntaje se reflejen
    const jsonOutput = page.locator('#jsonOutput');
    await expect(jsonOutput).toContainText('Excelente servicio probado mediante Playwright E2E');
    await expect(jsonOutput).toContainText('5');
  });

  test('debe registrar peticiones en el historial y permitir limpiarlo', async ({ page }) => {
    // Ejecutar una petición para poblar el historial
    await page.locator('#btn_get_conductores').click();
    await page.locator('#sendBtn').click();
    await expect(page.locator('#statusBadge')).toContainText('200');

    // Debe haber al menos un elemento en el historial
    const historyItems = page.locator('#historyList > div');
    await expect(historyItems.first()).toBeVisible();

    // Limpiar historial
    await page.locator('button:has-text("Borrar historial")').click();

    // Verificar que vuelve al estado vacío
    await expect(page.locator('#historyList')).toContainText('No hay peticiones recientes');
  });

  test('debe alternar entre Test Runner y Swagger UI correctamente', async ({ page }) => {
    // Clic en pestaña Swagger UI
    await page.locator('#tabSwaggerBtn').click();

    // Test runner debe ocultarse y Swagger view mostrarse
    await expect(page.locator('#testerView')).toBeHidden();
    await expect(page.locator('#swaggerView')).toBeVisible();

    // El contenedor de Swagger UI debe inicializarse
    const swaggerContainer = page.locator('#swagger-ui');
    await expect(swaggerContainer).toBeVisible();

    // Swagger UI carga el título de la API
    await expect(swaggerContainer.locator('.title')).toContainText('Conductores API', { timeout: 10000 });

    // Regresar a Test Runner
    await page.locator('#tabTesterBtn').click();
    await expect(page.locator('#testerView')).toBeVisible();
    await expect(page.locator('#swaggerView')).toBeHidden();
  });

});
