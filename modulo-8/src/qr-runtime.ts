import type { Router } from 'express';

export interface QrModule {
  name: 'qr';
  router: Router;
  readiness(): Promise<{ status: string; [key: string]: unknown }>;
  start(): void;
  stop(): Promise<void>;
}

export async function loadQrModule(): Promise<QrModule> {
  const loaded: unknown = await import(new URL('../services/qr/dist/module.js', import.meta.url).href);
  if (typeof loaded !== 'object' || loaded === null || typeof (loaded as { createQrModule?: unknown }).createQrModule !== 'function') {
    throw new Error('No se pudo cargar createQrModule desde QR.');
  }
  const module = (loaded as { createQrModule: () => unknown }).createQrModule();
  if (typeof module !== 'object' || module === null || (module as { name?: unknown }).name !== 'qr') {
    throw new Error('El módulo QR no cumple el contrato de montaje M8.');
  }
  return module as QrModule;
}
