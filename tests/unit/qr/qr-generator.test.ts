import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { generateQrDataUrl, generateQrToken } from "../../../src/qr/qr-generator";

const BASE64URL_TOKEN_PATTERN = /^[A-Za-z0-9_-]+$/;
const HEX_SHA256_PATTERN = /^[0-9a-f]{64}$/;
const QR_DATA_URL_PATTERN = /^data:image\/png;base64,/;

describe("generateQrToken", () => {
  it("genera un token distinto en llamadas sucesivas", () => {
    const first = generateQrToken();
    const second = generateQrToken();

    expect(first.token).not.toBe(second.token);
    expect(first.tokenHash).not.toBe(second.tokenHash);
  });

  it("genera un token en base64url del largo esperado para 32 bytes", () => {
    const { token } = generateQrToken();

    expect(token).toHaveLength(43);
    expect(token).toMatch(BASE64URL_TOKEN_PATTERN);
  });

  it("genera un tokenHash hexadecimal de 64 caracteres", () => {
    const { tokenHash } = generateQrToken();

    expect(tokenHash).toHaveLength(64);
    expect(tokenHash).toMatch(HEX_SHA256_PATTERN);
  });

  it("el tokenHash corresponde a SHA-256(token) en hex", () => {
    const { token, tokenHash } = generateQrToken();

    const expectedHash = createHash("sha256").update(token).digest("hex");
    expect(tokenHash).toBe(expectedHash);
  });
});

describe("generateQrDataUrl", () => {
  it("produce un Data URL PNG que cumple el pattern de QrDataUrl del OpenAPI", async () => {
    const { token } = generateQrToken();

    const qrDataUrl = await generateQrDataUrl(token);

    expect(qrDataUrl).toMatch(QR_DATA_URL_PATTERN);
  });
});
