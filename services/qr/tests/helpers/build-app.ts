import type { Express } from "express";

import { createApp } from "../../src/app";
import type { DependencyCheck } from "../../src/health";
import { generateQrDataUrl, generateQrToken } from "../../src/qr-generator";
import { loadQrConfig } from "../../src/qr.config";
import { createQrService } from "../../src/qr.service";
import { createInMemoryQrStore, type QrStore } from "../../src/qr.store";

// Arma la aplicación con las mismas dependencias reales que server.ts. Por defecto usa un
// store en memoria nuevo, así cada prueba parte de un estado vacío, y una comprobación de
// Redis que siempre responde disponible.
export function buildApp(
  store: QrStore = createInMemoryQrStore(),
  checkRedis: DependencyCheck = async () => true,
): Express {
  const qrService = createQrService({
    store,
    config: loadQrConfig(),
    generateQrToken,
    generateQrDataUrl,
    now: () => new Date(),
  });

  return createApp({ qrService, checkRedis });
}
