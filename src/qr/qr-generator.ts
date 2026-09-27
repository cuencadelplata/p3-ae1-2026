import { createHash, randomBytes } from "node:crypto";

import QRCode from "qrcode";

export interface GeneratedQrToken {
  readonly token: string;
  readonly tokenHash: string;
}

const TOKEN_BYTE_LENGTH = 32;
const QR_ERROR_CORRECTION_LEVEL = "M";

export function generateQrToken(): GeneratedQrToken {
  const token = randomBytes(TOKEN_BYTE_LENGTH).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");

  return { token, tokenHash };
}

export async function generateQrDataUrl(token: string): Promise<string> {
  return QRCode.toDataURL(token, { errorCorrectionLevel: QR_ERROR_CORRECTION_LEVEL });
}
