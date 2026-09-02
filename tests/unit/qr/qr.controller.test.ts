/*
 * RF-8.2 — Pruebas unitarias de los handlers HTTP de QR.
 * Verifican validación y propagación de resultados/errores sin servidor Express.
 */
import type { Request, Response } from "express";
import { describe, expect, it, vi } from "vitest";

import { createQrHandlers } from "../../../src/qr/qr.controller";
import type { QrService } from "../../../src/qr/qr.service";
import type { QrGenerationResponse, QrValidationResponse } from "../../../src/qr/qr.types";
import { ApiError } from "../../../src/shared/api-error";

function createReq(body: unknown, isJson = true): Request {
  return {
    body,
    is: vi.fn().mockReturnValue(isJson ? "application/json" : false),
  } as unknown as Request;
}

function createRes(): Response {
  const res = {} as Response;
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

function createServiceDouble(): QrService {
  return {
    generateQr: vi.fn<(tripId: string) => Promise<QrGenerationResponse>>(),
    validateQr: vi.fn<(tripId: string, token: string) => QrValidationResponse>(),
  };
}

describe("createQrHandlers — generateQr", () => {
  it("responde 400 VALIDATION_ERROR con los details del validador cuando el body es inválido", async () => {
    const service = createServiceDouble();
    const handlers = createQrHandlers(service);
    const req = createReq({});
    const res = createRes();
    const next = vi.fn();

    await handlers.generateQr(req, res, next);

    expect(service.generateQr).not.toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
    const error = next.mock.calls[0][0] as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(400);
    expect(error.code).toBe("VALIDATION_ERROR");
    expect(error.details).toEqual([{ field: "tripId", reason: "Es un campo requerido." }]);
  });

  it("responde 415 cuando el content-type no es application/json", async () => {
    const service = createServiceDouble();
    const handlers = createQrHandlers(service);
    const req = createReq({ tripId: "trip-demo-001" }, false);
    const res = createRes();
    const next = vi.fn();

    await handlers.generateQr(req, res, next);

    expect(service.generateQr).not.toHaveBeenCalled();
    const error = next.mock.calls[0][0] as ApiError;
    expect(error.status).toBe(415);
    expect(error.code).toBe("UNSUPPORTED_MEDIA_TYPE");
  });

  it("con body válido llama al service con el tripId y responde 201 con el cuerpo del contrato", async () => {
    const response: QrGenerationResponse = {
      token: "token-en-claro",
      qrDataUrl: "data:image/png;base64,AAAA",
      expiresAt: "2026-09-01T12:05:00.000Z",
    };
    const service = createServiceDouble();
    vi.mocked(service.generateQr).mockResolvedValue(response);
    const handlers = createQrHandlers(service);
    const req = createReq({ tripId: "trip-demo-001" });
    const res = createRes();
    const next = vi.fn();

    await handlers.generateQr(req, res, next);

    expect(service.generateQr).toHaveBeenCalledWith("trip-demo-001");
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(response);
    expect(next).not.toHaveBeenCalled();
  });

  it("un ApiError lanzado por el service llega a next() sin transformarse ni perderse", async () => {
    const serviceError = new ApiError(409, "QR_ALREADY_USED", "El QR ya fue utilizado.");
    const service = createServiceDouble();
    vi.mocked(service.generateQr).mockRejectedValue(serviceError);
    const handlers = createQrHandlers(service);
    const req = createReq({ tripId: "trip-demo-001" });
    const res = createRes();
    const next = vi.fn();

    await handlers.generateQr(req, res, next);

    expect(next).toHaveBeenCalledWith(serviceError);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("un ApiError 500 QR_PROCESSING_ERROR del service llega a next() con status y code intactos", async () => {
    const serviceError = new ApiError(500, "QR_PROCESSING_ERROR", "No fue posible generar el QR.");
    const service = createServiceDouble();
    vi.mocked(service.generateQr).mockRejectedValue(serviceError);
    const handlers = createQrHandlers(service);
    const req = createReq({ tripId: "trip-demo-001" });
    const res = createRes();
    const next = vi.fn();

    await handlers.generateQr(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    const error = next.mock.calls[0][0] as ApiError;
    expect(error.status).toBe(500);
    expect(error.code).toBe("QR_PROCESSING_ERROR");
  });

  it("el rechazo del service se propaga a next() en vez de quedar colgado", async () => {
    const service = createServiceDouble();
    vi.mocked(service.generateQr).mockRejectedValue(new Error("fallo inesperado"));
    const handlers = createQrHandlers(service);
    const req = createReq({ tripId: "trip-demo-001" });
    const res = createRes();
    const next = vi.fn();

    await expect(handlers.generateQr(req, res, next)).resolves.toBeUndefined();

    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toBeInstanceOf(Error);
  });
});

describe("createQrHandlers — validateQr", () => {
  it("responde 400 VALIDATION_ERROR con los details del validador cuando el body es inválido", () => {
    const service = createServiceDouble();
    const handlers = createQrHandlers(service);
    const req = createReq({ tripId: "trip-demo-001" });
    const res = createRes();
    const next = vi.fn();

    handlers.validateQr(req, res, next);

    expect(service.validateQr).not.toHaveBeenCalled();
    const error = next.mock.calls[0][0] as ApiError;
    expect(error.status).toBe(400);
    expect(error.code).toBe("VALIDATION_ERROR");
    expect(error.details).toEqual([{ field: "token", reason: "Es un campo requerido." }]);
  });

  it("responde 415 cuando el content-type no es application/json", () => {
    const service = createServiceDouble();
    const handlers = createQrHandlers(service);
    const req = createReq({ tripId: "trip-demo-001", token: "abc" }, false);
    const res = createRes();
    const next = vi.fn();

    handlers.validateQr(req, res, next);

    expect(service.validateQr).not.toHaveBeenCalled();
    const error = next.mock.calls[0][0] as ApiError;
    expect(error.status).toBe(415);
    expect(error.code).toBe("UNSUPPORTED_MEDIA_TYPE");
  });

  it("con body válido llama al service con tripId y token, y responde 200 con el cuerpo del contrato", () => {
    const service = createServiceDouble();
    vi.mocked(service.validateQr).mockReturnValue({ valid: true });
    const handlers = createQrHandlers(service);
    const req = createReq({ tripId: "trip-demo-001", token: "valor-opaco" });
    const res = createRes();
    const next = vi.fn();

    handlers.validateQr(req, res, next);

    expect(service.validateQr).toHaveBeenCalledWith("trip-demo-001", "valor-opaco");
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ valid: true });
    expect(next).not.toHaveBeenCalled();
  });

  it("un ApiError lanzado por el service llega a next() sin transformarse ni perderse", () => {
    const serviceError = new ApiError(410, "QR_EXPIRED", "El QR ha vencido.");
    const service = createServiceDouble();
    vi.mocked(service.validateQr).mockImplementation(() => {
      throw serviceError;
    });
    const handlers = createQrHandlers(service);
    const req = createReq({ tripId: "trip-demo-001", token: "valor-opaco" });
    const res = createRes();
    const next = vi.fn();

    handlers.validateQr(req, res, next);

    expect(next).toHaveBeenCalledWith(serviceError);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("un ApiError 409 QR_ALREADY_USED del service llega a next() con status y code intactos", () => {
    const serviceError = new ApiError(409, "QR_ALREADY_USED", "El QR ya fue utilizado.");
    const service = createServiceDouble();
    vi.mocked(service.validateQr).mockImplementation(() => {
      throw serviceError;
    });
    const handlers = createQrHandlers(service);
    const req = createReq({ tripId: "trip-demo-001", token: "valor-opaco" });
    const res = createRes();
    const next = vi.fn();

    handlers.validateQr(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    const error = next.mock.calls[0][0] as ApiError;
    expect(error.status).toBe(409);
    expect(error.code).toBe("QR_ALREADY_USED");
  });
});
