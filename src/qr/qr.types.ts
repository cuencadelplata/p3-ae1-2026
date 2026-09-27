import type { ErrorDetail } from "../shared/api-error";

export interface QrRecord {
  readonly id: string;
  readonly tripId: string;
  readonly tokenHash: string;
  readonly createdAt: Date;
  readonly expiresAt: Date;
  usedAt: Date | null;
}

export interface QrGenerationRequest {
  readonly tripId: string;
}

export interface QrGenerationResponse {
  readonly token: string;
  readonly qrDataUrl: string;
  readonly expiresAt: string;
}

export interface QrValidationRequest {
  readonly tripId: string;
  readonly token: string;
}

export interface QrValidationResponse {
  readonly valid: true;
}

export type ValidationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly errors: ErrorDetail[] };
