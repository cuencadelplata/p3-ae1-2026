/*
 * Infraestructura — Pruebas de integración del endpoint de disponibilidad.
 * Verifican una respuesta técnica estable sin ejecutar reglas de RF-8.1 ni RF-8.2.
 */
import request from "supertest";
import { describe, expect, it } from "vitest";

import { app } from "../../../src/app";

describe("GET /health", () => {
  it("responde 200 JSON con el estado estable del servicio", async () => {
    const response = await request(app).get("/health");

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("application/json");
    expect(response.body).toEqual({ status: "ok", service: "m8" });
  });
});
