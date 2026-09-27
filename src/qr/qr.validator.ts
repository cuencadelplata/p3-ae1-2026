import type { ErrorDetail } from "../shared/api-error";
import type { QrGenerationRequest, QrValidationRequest, ValidationResult } from "./qr.types";

const NOT_AN_OBJECT_REASON = "El cuerpo debe ser un objeto JSON.";
const REQUIRED_FIELD_REASON = "Es un campo requerido.";
const STRING_MIN_LENGTH_REASON = "Debe ser un string con longitud mínima de 1.";
const UNKNOWN_PROPERTY_REASON = "Propiedad no permitida.";

function isPlainObject(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

function validateRequiredString(
  body: Record<string, unknown>,
  field: string,
  errors: ErrorDetail[],
): void {
  if (!Object.prototype.hasOwnProperty.call(body, field)) {
    errors.push({ field, reason: REQUIRED_FIELD_REASON });
    return;
  }

  const candidate = body[field];
  if (typeof candidate !== "string" || candidate.length < 1) {
    errors.push({ field, reason: STRING_MIN_LENGTH_REASON });
  }
}

function validateNoUnknownProperties(
  body: Record<string, unknown>,
  allowedFields: readonly string[],
  errors: ErrorDetail[],
): void {
  for (const field of Object.keys(body)) {
    if (!allowedFields.includes(field)) {
      errors.push({ field, reason: UNKNOWN_PROPERTY_REASON });
    }
  }
}

export function validateQrGenerationRequest(input: unknown): ValidationResult<QrGenerationRequest> {
  if (!isPlainObject(input)) {
    return { ok: false, errors: [{ field: "body", reason: NOT_AN_OBJECT_REASON }] };
  }

  const errors: ErrorDetail[] = [];
  const allowedFields = ["tripId"] as const;

  validateRequiredString(input, "tripId", errors);
  validateNoUnknownProperties(input, allowedFields, errors);

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return { ok: true, value: { tripId: input.tripId as string } };
}

export function validateQrValidationRequest(input: unknown): ValidationResult<QrValidationRequest> {
  if (!isPlainObject(input)) {
    return { ok: false, errors: [{ field: "body", reason: NOT_AN_OBJECT_REASON }] };
  }

  const errors: ErrorDetail[] = [];
  const allowedFields = ["tripId", "token"] as const;

  validateRequiredString(input, "tripId", errors);
  validateRequiredString(input, "token", errors);
  validateNoUnknownProperties(input, allowedFields, errors);

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: { tripId: input.tripId as string, token: input.token as string },
  };
}
