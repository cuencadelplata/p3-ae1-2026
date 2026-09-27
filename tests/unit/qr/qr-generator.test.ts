/*
 * RF-8.2 — Pruebas unitarias de token y representación QR.
 * Verifican opacidad, hash y contenido QR sin utilizar HTTP.
 */
import { createHash } from "node:crypto";

import jsQR from "jsqr";
import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";

import { generateQrDataUrl, generateQrToken } from "../../../src/qr/qr-generator";

const BASE64URL_TOKEN_PATTERN = /^[A-Za-z0-9_-]+$/;
const HEX_SHA256_PATTERN = /^[0-9a-f]{64}$/;
const QR_DATA_URL_PATTERN = /^data:image\/png;base64,/;

function decodeQrDataUrl(qrDataUrl: string): string {
  const base64 = qrDataUrl.replace(/^data:image\/png;base64,/, "");
  const png = PNG.sync.read(Buffer.from(base64, "base64"));
  const pixels = new Uint8ClampedArray(png.data.buffer, png.data.byteOffset, png.data.byteLength);

  const decoded = jsQR(pixels, png.width, png.height);
  if (decoded === null) {
    throw new Error("No se pudo decodificar el QR generado en el test.");
  }

  return decoded.data;
}

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

  it("el QR decodificado contiene exactamente el token, sin ningún otro dato", async () => {
    const { token } = generateQrToken();

    const qrDataUrl = await generateQrDataUrl(token);
    const decoded = decodeQrDataUrl(qrDataUrl);

    expect(decoded).toBe(token);
  });

  // Se cumple por construcción: generateQrDataUrl solo recibe `token`, nunca `tripId`.
  // Es una aserción explícita del criterio de diseño, no una que pueda fallar hoy.
  it("el QR decodificado no contiene el tripId, aunque exista uno conocido para ese token", async () => {
    const tripId = "trip-demo-001";
    const { token } = generateQrToken();

    const qrDataUrl = await generateQrDataUrl(token);
    const decoded = decodeQrDataUrl(qrDataUrl);

    expect(decoded).not.toContain(tripId);
  });
});
