import { test, expect } from '@playwright/test';

/**
 * Tests E2E con Playwright — M5 Solicitud y Despacho
 * Cubre:
 * - Carga de interfaz web y Health Check (RNF-16)
 * - RF-5.1: Creación de solicitud desde UI (Formulario, Presets, Cálculo tarifa)
 * - RF-5.2 & RF-5.3: Búsqueda de candidatos y despacho de ofertas con TTL
 * - RF-5.4 & RF-5.5: Aceptación de oferta por conductor y asignación única
 * - RF-5.6: Cancelación previa de solicitud con diálogo de confirmación
 * - RF-5.4 (Rechazo): Conductor rechaza oferta en la app móvil
 * - Flujo E2E completo vía API context de Playwright
 */

test.describe('M5 Dispatch Service — Pruebas End-to-End (E2E) con Playwright', () => {

  test.beforeEach(async ({ page }) => {
    // Abrir la aplicación web en el simulador
    await page.goto('/');
  });

  // ==========================================================================
  // Test 1: Verificación de Carga y Health Status
  // ==========================================================================
  test('E2E-01: Debe cargar la aplicación y verificar servicio ONLINE', async ({ page }) => {
    await expect(page).toHaveTitle(/M5: Solicitud y Despacho/);

    // Verificar header y branding
    const headerTitle = page.locator('header h1');
    await expect(headerTitle).toContainText('Módulo 5: Solicitud y Despacho');

    // Esperar a que el indicador de salud se conecte (polling de checkHealth)
    const healthText = page.locator('#healthText');
    await expect(healthText).toContainText('Servicio ONLINE', { timeout: 10_000 });
  });

  // ==========================================================================
  // Test 2: Flujo Feliz Completo (RF-5.1 -> RF-5.2 -> RF-5.3 -> RF-5.4 -> RF-5.5)
  // ==========================================================================
  test('E2E-02: Flujo completo — Solicitar viaje, buscar candidatos, despachar ofertas y aceptar como conductor', async ({ page }) => {
    // Activar vista Split (ambas pantallas visibles)
    await page.click('#tabBtnSplit');

    // Aplicar preset de ruta rápida (Obelisco -> Recoleta)
    await page.click("button:has-text('Obelisco ➔ Recoleta')");

    // Configurar un client ID único para evitar colisiones
    const uniqueClientId = `client_e2e_${Date.now()}`;
    await page.fill('#clientId', uniqueClientId);

    // 1. RF-5.1: Solicitar viaje
    await page.click('#btnSubmit');

    // Verificar que el viaje pasa a estar activo
    const statusBadge = page.locator('#tripStatusBadge');
    await expect(statusBadge).toBeVisible({ timeout: 5000 });
    await expect(statusBadge).toContainText('SEARCHING');

    // Verificar cálculo de tarifa estimada (M7 stub)
    const fareAmount = page.locator('#fareAmount');
    await expect(fareAmount).toBeVisible();
    await expect(fareAmount).not.toContainText('$0 ARS');

    // 2. RF-5.2 & RF-5.3: Buscar candidatos y enviar ofertas
    const btnSearch = page.locator('#btnSearchCandidates');
    await btnSearch.click();

    // Verificar que el badge de ofertas se actualiza a OFFERED
    await expect(statusBadge).toContainText('OFFERED', { timeout: 8000 });

    // Verificar lista de candidatos renderizada
    const candidatesList = page.locator('#candidatesListContainer');
    await expect(candidatesList).toBeVisible();

    // 3. RF-5.4 & RF-5.5: El conductor ve la oferta entrante y la acepta
    const incomingOffer = page.locator('#driverPhoneIncomingOffer');
    await expect(incomingOffer).toBeVisible({ timeout: 5000 });

    // Aceptar oferta
    const btnAccept = page.locator('#btnPhoneAccept');
    await btnAccept.click();

    // 4. Verificar asignación única (RF-5.5)
    const assignedScreen = page.locator('#driverPhoneAssignedState');
    await expect(assignedScreen).toBeVisible({ timeout: 5000 });
    await expect(assignedScreen).toContainText('¡Viaje Asignado!');

    // Verificar banner en el panel de cliente
    const assignedBanner = page.locator('#assignedBanner');
    await expect(assignedBanner).toBeVisible({ timeout: 5000 });
    await expect(statusBadge).toContainText('ASSIGNED');
  });

  // ==========================================================================
  // Test 3: Cancelación Previa por el Cliente (RF-5.6)
  // ==========================================================================
  test('E2E-03: Cancelación previa — El cliente cancela la solicitud antes de ser asignada', async ({ page }) => {
    // Aplicar preset
    await page.click("button:has-text('Palermo ➔ Pto. Madero')");

    const uniqueClientId = `client_cancel_${Date.now()}`;
    await page.fill('#clientId', uniqueClientId);

    // Crear solicitud
    await page.click('#btnSubmit');

    // Esperar a que la solicitud se procese y los detalles del viaje se hagan visibles
    await expect(page.locator('#activeTripDetails')).toBeVisible({ timeout: 10_000 });

    const statusBadge = page.locator('#tripStatusBadge');
    await expect(statusBadge).toContainText('SEARCHING');

    // Configurar listener para el diálogo `prompt()` de confirmación/motivo
    page.on('dialog', async (dialog) => {
      expect(dialog.type()).toBe('prompt');
      await dialog.accept('Ya no requiero el traslado');
    });

    // Clic en cancelar solicitud (RF-5.6)
    const btnCancel = page.locator('#btnCancelTrip');
    await expect(btnCancel).toBeEnabled({ timeout: 5000 });
    await btnCancel.click();

    // Verificar banner de cancelación y estado
    const cancelledBanner = page.locator('#cancelledBanner');
    await expect(cancelledBanner).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#cancelledReasonText')).toContainText('Ya no requiero el traslado');
    await expect(statusBadge).toContainText('CANCELLED');

    // El botón debe quedar deshabilitado
    await expect(btnCancel).toBeDisabled();
  });

  // ==========================================================================
  // Test 4: Rechazo de Oferta por Conductor (RF-5.4)
  // ==========================================================================
  test('E2E-04: Rechazo de oferta — El conductor rechaza la oferta entrante', async ({ page }) => {
    await page.click('#tabBtnSplit');
    await page.click("button:has-text('Belgrano ➔ Centro')");

    const uniqueClientId = `client_reject_${Date.now()}`;
    await page.fill('#clientId', uniqueClientId);

    // Crear solicitud y despachar
    await page.click('#btnSubmit');
    await page.locator('#btnSearchCandidates').click();

    // Esperar oferta en el smartphone
    const incomingOffer = page.locator('#driverPhoneIncomingOffer');
    await expect(incomingOffer).toBeVisible({ timeout: 5000 });

    // Rechazar la oferta
    const btnReject = page.locator('#btnPhoneReject');
    await btnReject.click();

    // La pantalla del smartphone vuelve a estar en búsqueda/idle
    const idleState = page.locator('#driverPhoneIdleState');
    await expect(idleState).toBeVisible({ timeout: 5000 });
  });

  // ==========================================================================
  // Test 5: Pipeline E2E Completo vía API de Playwright
  // ==========================================================================
  test('E2E-05: Ciclo de vida API completo verificado con Playwright request', async ({ request }) => {
    const clientId = `client_api_e2e_${Date.now()}`;
    const idempotencyKey = `idem_e2e_${Date.now()}`;

    // 1. Crear solicitud
    const createRes = await request.post('/api/v1/ride-requests', {
      headers: {
        'x-user-id': clientId,
        'Idempotency-Key': idempotencyKey,
      },
      data: {
        origin: { latitude: -34.6037, longitude: -58.3816, address: 'Obelisco' },
        destination: { latitude: -34.5885, longitude: -58.3974, address: 'Recoleta' },
        vehicleType: 'AUTO',
      },
    });
    expect(createRes.status()).toBe(201);
    const ride = await createRes.json();
    expect(ride.status).toBe('SEARCHING');

    // 2. Buscar candidatos (RF-5.2)
    const candRes = await request.post(`/api/v1/ride-requests/${ride.id}/candidates`, {
      headers: { 'x-user-id': clientId },
      data: { radiusKm: 5, maxCandidates: 2 },
    });
    expect(candRes.status()).toBe(200);
    const cands = await candRes.json();
    expect(cands.candidatesCount).toBeGreaterThan(0);

    // 3. Enviar oferta (RF-5.3)
    const offerRes = await request.post(`/api/v1/ride-requests/${ride.id}/offers`, {
      headers: { 'x-user-id': clientId },
      data: { ttlSeconds: 45, driverIds: ['drv_101'] },
    });
    expect(offerRes.status()).toBe(201);
    const offersData = await offerRes.json();
    const offer = offersData.offers[0];

    // 4. Aceptar oferta (RF-5.4 & RF-5.5)
    const acceptRes = await request.post(`/api/v1/offers/${offer.id}/accept`, {
      headers: { 'x-driver-id': 'drv_101' },
    });
    expect(acceptRes.status()).toBe(200);
    const acceptData = await acceptRes.json();
    expect(acceptData.requestStatus).toBe('ASSIGNED');
    expect(acceptData.assignedDriverId).toBe('drv_101');

    // 5. Intentar cancelar solicitud ya asignada (debe fallar 409)
    const cancelRes = await request.post(`/api/v1/ride-requests/${ride.id}/cancel`, {
      headers: {
        'x-user-id': clientId,
        'Content-Type': 'application/json',
      },
      data: { reason: 'Test' },
    });
    if (cancelRes.status() !== 409) {
      console.log('DEBUG cancelRes status:', cancelRes.status(), await cancelRes.text());
    }
    expect(cancelRes.status()).toBe(409);
  });

});
