/*
 * Infraestructura — Prueba E2E API de disponibilidad contra Docker.
 * Verifica que el servicio M8 real responda su health check sin efectos de negocio.
 */
import { describe, expect, inject, it } from "vitest";

import "../infrastructure/vitest-context";

const baseUrl = inject("e2eBaseUrl");

describe("GET /health E2E", () => {
  it("responde disponibilidad estable desde el servicio M8 en Docker", async () => {
    const response = await fetch(`${baseUrl}/health`);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    await expect(response.json()).resolves.toEqual({ status: "ok", service: "m8" });
  });
});
