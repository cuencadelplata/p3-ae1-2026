/* Recursos públicos históricos del servicio M8 integrado. */
import request from "supertest";
import { describe, expect, it } from "vitest";

import { app } from "../../../src/app";

describe("recursos públicos", () => {
  it("sirve la interfaz de demostración integrada RF-8.1 y RF-8.2", async () => {
    const response = await request(app).get("/");
    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.text).toContain("M8 - Notificaciones");
    expect(response.text).toContain("notification-form");
    expect(response.text).toContain("RF-8.2 — Verificación QR");
    expect(response.text).toContain("qr-generation-form");
    expect(response.text).toContain("qr-image");
    expect(response.text).toContain("qr-countdown");
    expect(response.text).toContain("validate-qr-button");
    expect(response.text).toContain("/styles.css");
    expect(response.text).toContain("/app.js");
    expect(response.text).toContain("/openapi.yaml");
  });

  it("sirve la hoja de estilos de la interfaz", async () => {
    const response = await request(app).get("/styles.css");
    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("text/css");
    expect(response.text.length).toBeGreaterThan(0);
  });

  it("sirve el script de la interfaz", async () => {
    const response = await request(app).get("/app.js");
    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("javascript");
    expect(response.text.length).toBeGreaterThan(0);
    expect(response.text).toContain("/notifications");
    expect(response.text).toContain("/qr");
    expect(response.text).toContain("/qr/validate");
  });

  it("sirve el contrato OpenAPI aprobado", async () => {
    const response = await request(app).get("/openapi.yaml");
    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("yaml");
    expect(response.text).toContain("openapi: 3.0.3");
    expect(response.text).toContain("/notifications");
    expect(response.text).toContain("post:");
  });
});
