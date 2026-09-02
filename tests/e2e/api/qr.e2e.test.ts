/*
 * RF-8.2 — Prueba E2E API contra el servicio M8 en Docker.
 * Verifica generación, validación y uso único mediante HTTP real.
 */
import { describe, expect, inject, it } from "vitest";

import "../infrastructure/vitest-context";

const baseUrl = inject("e2eBaseUrl");
const QR_TTL_SECONDS = 120;

describe("E2E — servicio M8 integrado (RF-8.2)", () => {
  it("genera, valida y revalida un QR usando el TTL configurado en el contenedor", async () => {
    const generateResponse = await fetch(`${baseUrl}/qr`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tripId: "trip-e2e-001" }),
    });
    expect(generateResponse.status).toBe(201);

    const generateBody = (await generateResponse.json()) as {
      token: string;
      qrDataUrl: string;
      expiresAt: string;
    };
    expect(generateBody.qrDataUrl).toMatch(/^data:image\/png;base64,/);

    const actualTtlSeconds = (new Date(generateBody.expiresAt).getTime() - Date.now()) / 1000;
    expect(actualTtlSeconds).toBeGreaterThan(QR_TTL_SECONDS - 20);
    expect(actualTtlSeconds).toBeLessThan(QR_TTL_SECONDS + 20);

    const validateResponse = await fetch(`${baseUrl}/qr/validate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tripId: "trip-e2e-001", token: generateBody.token }),
    });
    expect(validateResponse.status).toBe(200);
    expect(await validateResponse.json()).toEqual({ valid: true });

    const revalidateResponse = await fetch(`${baseUrl}/qr/validate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tripId: "trip-e2e-001", token: generateBody.token }),
    });
    expect(revalidateResponse.status).toBe(409);
    expect(await revalidateResponse.json()).toEqual({
      error: { code: "QR_ALREADY_USED", message: "El QR ya fue utilizado." },
    });
  });
});
