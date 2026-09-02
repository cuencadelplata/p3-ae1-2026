/*
 * Infraestructura — Pruebas de integración de la documentación OpenAPI local.
 * Verifican redirección, HTML y carga del contrato sin depender de servicios externos.
 */
import request from "supertest";
import { describe, expect, it } from "vitest";

import { app } from "../../../src/app";

describe("documentación interactiva de API", () => {
  it("redirige /api-docs hacia la interfaz Swagger UI", async () => {
    const response = await request(app).get("/api-docs");

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe("/api-docs/");
  });

  it("sirve HTML local configurado para cargar /openapi.yaml", async () => {
    const response = await request(app).get("/api-docs/");

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.text).toContain("/openapi.yaml");
    expect(response.text).toContain("/api-docs-assets/swagger-ui-bundle.js");
  });
});
