import type { Express } from "express";

import { createApp } from "../../src/app";
import type { DependencyCheck } from "../../src/health";
import type { Logger } from "../../src/observability/logger";
import { generateQrDataUrl, generateQrToken } from "../../src/qr-generator";
import { loadQrConfig } from "../../src/qr.config";
import { createQrService } from "../../src/qr.service";
import { createInMemoryQrStore, type QrStore } from "../../src/qr.store";

export interface BuildAppOptions {
  readonly store?: QrStore;
  readonly checkRedis?: DependencyCheck;
  readonly log?: Logger;
  readonly now?: () => Date;
}

// Arma la aplicación con las mismas dependencias reales que server.ts. Por defecto usa un
// store en memoria nuevo, así cada prueba parte de un estado vacío, una comprobación de
// Redis que siempre responde disponible y un logger del service que no escribe.
export function buildApp(options: BuildAppOptions = {}): Express {
  const qrService = createQrService({
    store: options.store ?? createInMemoryQrStore(),
    config: loadQrConfig(),
    generateQrToken,
    generateQrDataUrl,
    now: options.now ?? (() => new Date()),
    log: options.log ?? (() => {}),
  });

  return createApp({ qrService, checkRedis: options.checkRedis ?? (async () => true) });
}
