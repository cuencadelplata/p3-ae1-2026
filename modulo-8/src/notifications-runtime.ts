import type { Router } from 'express';

export interface NotificationsModule {
  name: 'notifications';
  router: Router;
  readiness(): Promise<{ status: string }>;
  start(): void;
  stop(): Promise<void>;
}

export async function loadNotificationsModule(): Promise<NotificationsModule> {
  const loaded: unknown = await import(new URL('../services/notifications/dist/notifications/module.js', import.meta.url).href);
  if (typeof loaded !== 'object' || loaded === null || typeof (loaded as { createNotificationsModule?: unknown }).createNotificationsModule !== 'function') {
    throw new Error('No se pudo cargar createNotificationsModule desde Notifications.');
  }
  const module = (loaded as { createNotificationsModule: () => unknown }).createNotificationsModule();
  if (typeof module !== 'object' || module === null || (module as { name?: unknown }).name !== 'notifications') {
    throw new Error('El módulo Notifications no cumple el contrato de montaje M8.');
  }
  return module as NotificationsModule;
}
