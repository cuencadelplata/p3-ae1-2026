import type { Router } from 'express';

export interface ModuleReadiness {
  status: string;
  [key: string]: unknown;
}

export interface ReceiptsModule {
  name: 'receipts';
  router: Router;
  readiness(): Promise<ModuleReadiness>;
  start(): void;
  stop(): Promise<void>;
}

type ReceiptsModuleFactory = () => ReceiptsModule;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isReceiptsModuleFactory(value: unknown): value is ReceiptsModuleFactory {
  return typeof value === 'function';
}

function isReceiptsModule(value: unknown): value is ReceiptsModule {
  return (
    isObject(value) &&
    value.name === 'receipts' &&
    typeof value.router === 'function' &&
    typeof value.readiness === 'function' &&
    typeof value.start === 'function' &&
    typeof value.stop === 'function'
  );
}

/** Carga el módulo ya compilado sin importar su entrypoint independiente. */
export async function loadReceiptsModule(): Promise<ReceiptsModule> {
  const moduleUrl = new URL('../services/receipts/dist/module.js', import.meta.url);
  const imported: unknown = await import(moduleUrl.href);

  if (!isObject(imported) || !isReceiptsModuleFactory(imported.createReceiptsModule)) {
    throw new Error('No se pudo cargar createReceiptsModule desde Receipts.');
  }

  const receipts = imported.createReceiptsModule();
  if (!isReceiptsModule(receipts)) {
    throw new Error('El módulo Receipts no cumple el contrato de montaje M8.');
  }

  return receipts;
}
