import request from "supertest";
import { describe, expect, it } from "vitest";

import { createApp } from "../../src/app";
import { registerQrRoutes } from "../../src/qr/qr.controller";

function buildApp() {
  return createApp(registerQrRoutes);
}

describe("POST /qr", () => {
  it("responde 201 con token, qrDataUrl PNG y expiresAt en ISO 8601", async () => {
    const app = buildApp();

    const response = await request(app).post("/qr").send({ tripId: "trip-demo-001" });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      token: expect.any(String),
      qrDataUrl: expect.stringMatching(/^data:image\/png;base64,/),
      expiresAt: expect.any(String),
    });
    expect(response.body.token.length).toBeGreaterThan(0);
    expect(new Date(response.body.expiresAt).toISOString()).toBe(response.body.expiresAt);
  });

  it("responde 400 VALIDATION_ERROR cuando falta tripId", async () => {
    const app = buildApp();

    const response = await request(app).post("/qr").send({});

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: {
        code: "VALIDATION_ERROR",
        message: "La solicitud contiene datos inválidos.",
        details: [{ field: "tripId", reason: "Es un campo requerido." }],
      },
    });
  });

  it("responde 400 VALIDATION_ERROR con una propiedad no declarada", async () => {
    const app = buildApp();

    const response = await request(app).post("/qr").send({ tripId: "trip-demo-001", extra: "x" });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: {
        code: "VALIDATION_ERROR",
        message: "La solicitud contiene datos inválidos.",
        details: [{ field: "extra", reason: "Propiedad no permitida." }],
      },
    });
  });

  it("responde 415 UNSUPPORTED_MEDIA_TYPE con Content-Type text/plain", async () => {
    const app = buildApp();

    const response = await request(app)
      .post("/qr")
      .set("Content-Type", "text/plain")
      .send("tripId=trip-demo-001");

    expect(response.status).toBe(415);
    expect(response.body).toEqual({
      error: {
        code: "UNSUPPORTED_MEDIA_TYPE",
        message: "El tipo de contenido debe ser application/json.",
      },
    });
  });

  it("un JSON malformado sigue devolviendo 400 VALIDATION_ERROR por el errorHandler compartido", async () => {
    const app = buildApp();

    const response = await request(app)
      .post("/qr")
      .set("Content-Type", "application/json")
      .send('{"tripId": "trip-demo-001"');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: {
        code: "VALIDATION_ERROR",
        message: "La solicitud contiene datos inválidos.",
        details: [{ field: "body", reason: "El JSON no es válido." }],
      },
    });
  });
});

describe("POST /qr/validate", () => {
  it("responde 200 { valid: true } para un QR recién generado en la misma app", async () => {
    const app = buildApp();
    const generateResponse = await request(app).post("/qr").send({ tripId: "trip-demo-001" });

    const response = await request(app)
      .post("/qr/validate")
      .send({ tripId: "trip-demo-001", token: generateResponse.body.token });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ valid: true });
  });

  it("responde 409 QR_ALREADY_USED al validar el mismo QR dos veces", async () => {
    const app = buildApp();
    const generateResponse = await request(app).post("/qr").send({ tripId: "trip-demo-001" });
    const token = generateResponse.body.token as string;

    await request(app).post("/qr/validate").send({ tripId: "trip-demo-001", token });
    const secondResponse = await request(app)
      .post("/qr/validate")
      .send({ tripId: "trip-demo-001", token });

    expect(secondResponse.status).toBe(409);
    expect(secondResponse.body).toEqual({
      error: { code: "QR_ALREADY_USED", message: "El QR ya fue utilizado." },
    });
  });

  it("responde 404 QR_NOT_FOUND con un token inexistente", async () => {
    const app = buildApp();

    const response = await request(app)
      .post("/qr/validate")
      .send({ tripId: "trip-demo-001", token: "token-que-no-existe" });

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      error: {
        code: "QR_NOT_FOUND",
        message: "No se encontró un QR correspondiente al token y viaje indicados.",
      },
    });
  });

  it("responde 404 QR_NOT_FOUND, idéntico al de token inexistente, cuando el tripId no corresponde al token", async () => {
    const app = buildApp();
    const generateResponse = await request(app).post("/qr").send({ tripId: "trip-demo-001" });
    const token = generateResponse.body.token as string;

    const mismatchResponse = await request(app)
      .post("/qr/validate")
      .send({ tripId: "otro-trip-que-no-es-el-dueño", token });
    const notFoundResponse = await request(app)
      .post("/qr/validate")
      .send({ tripId: "trip-demo-001", token: "token-que-no-existe" });

    expect(mismatchResponse.status).toBe(404);
    expect(mismatchResponse.status).toBe(notFoundResponse.status);
    expect(mismatchResponse.body).toEqual(notFoundResponse.body);
  });

  it("responde 400 VALIDATION_ERROR cuando falta token", async () => {
    const app = buildApp();

    const response = await request(app).post("/qr/validate").send({ tripId: "trip-demo-001" });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: {
        code: "VALIDATION_ERROR",
        message: "La solicitud contiene datos inválidos.",
        details: [{ field: "token", reason: "Es un campo requerido." }],
      },
    });
  });

  it("responde 415 UNSUPPORTED_MEDIA_TYPE con Content-Type text/plain", async () => {
    const app = buildApp();

    const response = await request(app)
      .post("/qr/validate")
      .set("Content-Type", "text/plain")
      .send("tripId=trip-demo-001&token=abc");

    expect(response.status).toBe(415);
    expect(response.body).toEqual({
      error: {
        code: "UNSUPPORTED_MEDIA_TYPE",
        message: "El tipo de contenido debe ser application/json.",
      },
    });
  });
});

describe("flujo completo de uso único vía HTTP", () => {
  it("generar -> validar con éxito -> revalidar y obtener 409", async () => {
    const app = buildApp();

    const generateResponse = await request(app).post("/qr").send({ tripId: "trip-demo-001" });
    expect(generateResponse.status).toBe(201);
    const token = generateResponse.body.token as string;

    const firstValidation = await request(app)
      .post("/qr/validate")
      .send({ tripId: "trip-demo-001", token });
    expect(firstValidation.status).toBe(200);
    expect(firstValidation.body).toEqual({ valid: true });

    const secondValidation = await request(app)
      .post("/qr/validate")
      .send({ tripId: "trip-demo-001", token });
    expect(secondValidation.status).toBe(409);
    expect(secondValidation.body).toEqual({
      error: { code: "QR_ALREADY_USED", message: "El QR ya fue utilizado." },
    });
  });
});
