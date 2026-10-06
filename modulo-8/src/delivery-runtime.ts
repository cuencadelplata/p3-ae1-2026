import type { Router } from 'express';

export interface DeliveryModule {
  name: 'delivery';
  router: Router;
  readiness(): Promise<{ status: string }>;
  start(): void;
  stop(): Promise<void>;
}

export async function loadDeliveryModule(): Promise<DeliveryModule> {
  const loaded: unknown = await import(new URL('../services/notification-delivery/dist/module.js', import.meta.url).href);
  if (typeof loaded !== 'object' || loaded === null || typeof (loaded as { createDeliveryModule?: unknown }).createDeliveryModule !== 'function') throw new Error('No se pudo cargar createDeliveryModule desde Delivery.');
  const module = (loaded as { createDeliveryModule: () => unknown }).createDeliveryModule();
  if (typeof module !== 'object' || module === null || (module as { name?: unknown }).name !== 'delivery') throw new Error('El módulo Delivery no cumple el contrato de montaje M8.');
  return module as DeliveryModule;
}
