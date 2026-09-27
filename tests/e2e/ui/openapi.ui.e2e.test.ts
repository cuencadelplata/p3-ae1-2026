/*
 * Infraestructura — Prueba E2E UI de Swagger UI en Chromium contra Docker.
 * Verifica que el contrato real de M8 se renderice localmente sin usar CDN.
 */
import { expect, test } from "@playwright/test";

function getBaseUrl(): string {
  const baseUrl = process.env.M8_E2E_BASE_URL;

  if (!baseUrl) {
    throw new Error("La configuración E2E no proporcionó M8_E2E_BASE_URL.");
  }

  return baseUrl;
}

test("renderiza las operaciones públicas del contrato M8", async ({ page }) => {
  await page.goto(`${getBaseUrl()}/api-docs/`);

  await expect(page.locator("#swagger-ui .swagger-ui")).toBeVisible();
  await expect(page.locator(".opblock-get .opblock-summary-path", { hasText: /^\/health$/ })).toBeVisible();
  await expect(page.locator(".opblock-post .opblock-summary-path", { hasText: /^\/notifications$/ })).toBeVisible();
  await expect(page.locator(".opblock-post .opblock-summary-path", { hasText: /^\/qr$/ })).toBeVisible();
  await expect(page.locator(".opblock-post .opblock-summary-path", { hasText: /^\/qr\/validate$/ })).toBeVisible();
});
