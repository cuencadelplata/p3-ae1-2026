import type { Router } from 'express';

export interface SupportModule {
  name: 'support';
  router: Router;
  readiness(): Promise<{ status: string }>;
  start(): void;
  stop(): Promise<void>;
}

export async function loadSupportModule(): Promise<SupportModule> {
  const loaded: unknown = await import(new URL('../services/support/dist/module.js', import.meta.url).href);
  if (typeof loaded !== 'object' || loaded === null || typeof (loaded as { createSupportModule?: unknown }).createSupportModule !== 'function') {
    throw new Error('No se pudo cargar createSupportModule desde Support.');
  }
  const module = (loaded as { createSupportModule: () => unknown }).createSupportModule();
  if (typeof module !== 'object' || module === null || (module as { name?: unknown }).name !== 'support') {
    throw new Error('El módulo Support no cumple el contrato de montaje M8.');
  }
  return module as SupportModule;
}
