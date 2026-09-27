/*
 * Infraestructura — Pruebas E2E API de OpenAPI y Swagger UI contra Docker.
 * Verifican que el contrato y la interfaz local estén disponibles por HTTP real.
 */
import { describe, expect, inject, it } from "vitest";

import "../infrastructure/vitest-context";

const baseUrl = inject("e2eBaseUrl");

describe("OpenAPI y Swagger UI E2E", () => {
  it("sirve el contrato y la documentación interactiva local desde Docker", async () => {
    const contractResponse = await fetch(`${baseUrl}/openapi.yaml`);
    expect(contractResponse.status).toBe(200);
    expect(await contractResponse.text()).toContain("/qr/validate");

    const docsResponse = await fetch(`${baseUrl}/api-docs/`);
    expect(docsResponse.status).toBe(200);
    expect(docsResponse.headers.get("content-type")).toContain("text/html");
    expect(await docsResponse.text()).toContain("/openapi.yaml");

    const assetResponse = await fetch(`${baseUrl}/api-docs-assets/swagger-ui-bundle.js`);
    expect(assetResponse.status).toBe(200);
    expect(assetResponse.headers.get("content-type")).toContain("javascript");
  });
});
