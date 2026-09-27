/*
 * M8 integrado — Prueba E2E de la interfaz en Chromium contra Docker.
 * Verifica los flujos de demostración RF-8.1 y RF-8.2 mediante HTTP real, sin mocks.
 */
import { expect, test } from "@playwright/test";

function getBaseUrl(): string {
  const baseUrl = process.env.M8_E2E_BASE_URL;

  if (!baseUrl) {
    throw new Error("La configuración E2E no proporcionó M8_E2E_BASE_URL.");
  }

  return baseUrl;
}

test("permite demostrar notificaciones y QR desde la interfaz integrada", async ({ page }) => {
  await page.goto(getBaseUrl());

  await expect(page.getByRole("heading", { name: "RF-8.1 — Notificaciones" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "RF-8.2 — Verificación QR" })).toBeVisible();

  await page.getByRole("button", { name: "Procesar evento en M8" }).click();
  await expect(page.getByRole("heading", { name: "Notificación procesada por M8" })).toBeVisible();

  await page.locator("#qr-trip-id").fill("trip-ui-e2e-001");
  await page.getByRole("button", { name: "Generar QR" }).click();
  await expect(page.locator("#qr-image")).toBeVisible();
  await expect(page.locator("#qr-countdown")).toHaveText(/\d{2}:\d{2}/);

  await page.getByRole("button", { name: "Validar QR" }).click();
  await expect(page.getByRole("heading", { name: "QR VÁLIDO" })).toBeVisible();
  await expect(page.getByText(/Estado del QR: CONSUMIDO/)).toBeVisible();

  await page.getByRole("button", { name: "Probar reutilización" }).click();
  await expect(page.getByRole("heading", { name: "QR ya utilizado" })).toBeVisible();
});
