/*
 * RF-8.2 — Pruebas unitarias de validación de solicitudes QR.
 * Verifican el esquema y los detalles de error sin levantar un servidor.
 */
import { describe, expect, it } from "vitest";

import { validateQrGenerationRequest, validateQrValidationRequest } from "../../../src/qr/qr.validator";

describe("validateQrGenerationRequest", () => {
  it("acepta un cuerpo válido", () => {
    const result = validateQrGenerationRequest({ tripId: "trip-demo-001" });

    expect(result).toEqual({ ok: true, value: { tripId: "trip-demo-001" } });
  });

  it("acepta un tripId de exactamente 1 carácter (borde de minLength: 1)", () => {
    const result = validateQrGenerationRequest({ tripId: "a" });

    expect(result).toEqual({ ok: true, value: { tripId: "a" } });
  });

  it("rechaza cuando falta tripId", () => {
    const result = validateQrGenerationRequest({});

    expect(result).toEqual({
      ok: false,
      errors: [{ field: "tripId", reason: "Es un campo requerido." }],
    });
  });

  it("rechaza cuando tripId está vacío", () => {
    const result = validateQrGenerationRequest({ tripId: "" });

    expect(result).toEqual({
      ok: false,
      errors: [{ field: "tripId", reason: "Debe ser un string con longitud mínima de 1." }],
    });
  });

  it("rechaza cuando tripId no es un string", () => {
    const result = validateQrGenerationRequest({ tripId: 123 });

    expect(result).toEqual({
      ok: false,
      errors: [{ field: "tripId", reason: "Debe ser un string con longitud mínima de 1." }],
    });
  });

  it("rechaza propiedades no declaradas", () => {
    const result = validateQrGenerationRequest({ tripId: "trip-demo-001", extra: "x" });

    expect(result).toEqual({
      ok: false,
      errors: [{ field: "extra", reason: "Propiedad no permitida." }],
    });
  });

  it("rechaza dos propiedades no declaradas simultáneas, informando ambas", () => {
    const result = validateQrGenerationRequest({ tripId: "trip-demo-001", extra1: 1, extra2: 2 });

    expect(result).toEqual({
      ok: false,
      errors: [
        { field: "extra1", reason: "Propiedad no permitida." },
        { field: "extra2", reason: "Propiedad no permitida." },
      ],
    });
  });

  it("rechaza un cuerpo que no es un objeto JSON", () => {
    for (const input of [null, [], "trip-demo-001", 123]) {
      const result = validateQrGenerationRequest(input);

      expect(result).toEqual({
        ok: false,
        errors: [{ field: "body", reason: "El cuerpo debe ser un objeto JSON." }],
      });
    }
  });

  it("acumula varios campos inválidos a la vez", () => {
    const result = validateQrGenerationRequest({ extra: "x" });

    expect(result).toEqual({
      ok: false,
      errors: [
        { field: "tripId", reason: "Es un campo requerido." },
        { field: "extra", reason: "Propiedad no permitida." },
      ],
    });
  });
});

describe("validateQrValidationRequest", () => {
  it("acepta un cuerpo válido", () => {
    const result = validateQrValidationRequest({ tripId: "trip-demo-001", token: "valor-opaco" });

    expect(result).toEqual({
      ok: true,
      value: { tripId: "trip-demo-001", token: "valor-opaco" },
    });
  });

  it("acepta tripId y token de exactamente 1 carácter (borde de minLength: 1)", () => {
    const result = validateQrValidationRequest({ tripId: "a", token: "a" });

    expect(result).toEqual({ ok: true, value: { tripId: "a", token: "a" } });
  });

  it("rechaza cuando falta token", () => {
    const result = validateQrValidationRequest({ tripId: "trip-demo-001" });

    expect(result).toEqual({
      ok: false,
      errors: [{ field: "token", reason: "Es un campo requerido." }],
    });
  });

  it("rechaza cuando token está vacío", () => {
    const result = validateQrValidationRequest({ tripId: "trip-demo-001", token: "" });

    expect(result).toEqual({
      ok: false,
      errors: [{ field: "token", reason: "Debe ser un string con longitud mínima de 1." }],
    });
  });

  it("rechaza cuando token no es un string", () => {
    const result = validateQrValidationRequest({ tripId: "trip-demo-001", token: true });

    expect(result).toEqual({
      ok: false,
      errors: [{ field: "token", reason: "Debe ser un string con longitud mínima de 1." }],
    });
  });

  it("rechaza propiedades no declaradas", () => {
    const result = validateQrValidationRequest({
      tripId: "trip-demo-001",
      token: "valor-opaco",
      extra: "x",
    });

    expect(result).toEqual({
      ok: false,
      errors: [{ field: "extra", reason: "Propiedad no permitida." }],
    });
  });

  it("rechaza un cuerpo que no es un objeto JSON", () => {
    for (const input of [null, [], "valor-opaco", 123]) {
      const result = validateQrValidationRequest(input);

      expect(result).toEqual({
        ok: false,
        errors: [{ field: "body", reason: "El cuerpo debe ser un objeto JSON." }],
      });
    }
  });

  it("acumula varios campos inválidos a la vez", () => {
    const result = validateQrValidationRequest({ tripId: "", extra: "x" });

    expect(result).toEqual({
      ok: false,
      errors: [
        { field: "tripId", reason: "Debe ser un string con longitud mínima de 1." },
        { field: "token", reason: "Es un campo requerido." },
        { field: "extra", reason: "Propiedad no permitida." },
      ],
    });
  });
});
