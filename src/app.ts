import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

import { apiReference } from '@scalar/express-api-reference';
import express, { type Express, type Request, type Response } from 'express';

import { loadReceiptsModule, type ReceiptsModule } from './receipts-runtime.js';
import { loadQrModule, type QrModule } from './qr-runtime.js';
import { loadSupportModule, type SupportModule } from './support-runtime.js';
import { loadNotificationsModule, type NotificationsModule } from './notifications-runtime.js';
import { loadDeliveryModule, type DeliveryModule } from './delivery-runtime.js';

export interface M8Application {
  app: Express;
  start(): void;
  stop(): Promise<void>;
}

export interface M8ApplicationModules {
  receipts: ReceiptsModule;
  qr: QrModule;
  support: SupportModule;
  notifications: NotificationsModule;
  delivery: DeliveryModule;
}

export async function createM8Application(): Promise<M8Application> {
  const receipts = await loadReceiptsModule();
  const qr = await loadQrModule();
  const support = await loadSupportModule();
  const notifications = await loadNotificationsModule();
  const delivery = await loadDeliveryModule();
  return createM8ApplicationFromModules({ receipts, qr, support, notifications, delivery });
}

/** Construye la app común a partir de módulos ya creados; facilita pruebas sin infraestructura externa. */
export function createM8ApplicationFromModules(modules: M8ApplicationModules): M8Application {
  const { receipts, qr, support, notifications, delivery } = modules;
  const app = express();

  app.disable('x-powered-by');
  app.use((_request: Request, response: Response, next) => {
    const incoming = _request.header('X-Correlation-Id');
    const correlationId = incoming && /^[A-Za-z0-9._:-]{1,128}$/.test(incoming) ? incoming : randomUUID();
    response.setHeader('X-Correlation-Id', correlationId);
    next();
  });
  app.get('/health/live', (_request: Request, response: Response) => {
    response.status(200).json({ status: 'ok', service: 'm8' });
  });

  const ready = async (_request: Request, response: Response): Promise<void> => {
    const receiptReadiness = await receipts.readiness();
    const qrReadiness = await qr.readiness();
    const supportReadiness = await support.readiness();
    const notificationsReadiness = await notifications.readiness();
    const deliveryReadiness = await delivery.readiness();
    const moduleReadiness = {
      receipts: receiptReadiness,
      qr: qrReadiness,
      support: supportReadiness,
      notifications: notificationsReadiness,
      delivery: deliveryReadiness,
    };
    const statuses = Object.values(moduleReadiness).map((module) => module.status);
    const status = statuses.includes('unavailable')
      ? 'unavailable'
      : statuses.every((moduleStatus) => moduleStatus === 'ok')
        ? 'ok'
        : 'degraded';
    response.status(status === 'unavailable' ? 503 : 200).json({ status, modules: moduleReadiness });
  };

  app.get('/health/ready', ready);
  app.get('/health', ready);
  registerDocumentation(app);
  app.use(qr.router);
  app.use(receipts.router);
  app.use(support.router);
  app.use(notifications.router);
  app.use(delivery.router);
  app.use((_request: Request, response: Response) => {
    response.status(404).json({ error: { code: 'NOT_FOUND', message: 'Ruta no encontrada.' } });
  });

  return createApplicationLifecycle(app, receipts, qr, support, notifications, delivery);
}

function registerDocumentation(app: Express): void {
  const openapiPath = resolve(process.cwd(), 'openapi', 'm8-openapi.yaml');
  app.get('/openapi.yaml', (_request: Request, response: Response) => {
    response.type('application/yaml').send(readFileSync(openapiPath, 'utf8'));
  });
  app.use(
    '/docs',
    apiReference({
      pageTitle: 'M8 API Reference',
      spec: { url: '/openapi.yaml' },
    }),
  );
}

function createApplicationLifecycle(app: Express, receipts: ReceiptsModule, qr: QrModule, support: SupportModule, notifications: NotificationsModule, delivery: DeliveryModule): M8Application {
  return {
    app,
    start(): void {
      receipts.start();
      qr.start();
      support.start();
      notifications.start();
      delivery.start();
    },
    async stop(): Promise<void> {
      await Promise.all([receipts.stop(), qr.stop(), support.stop(), notifications.stop(), delivery.stop()]);
    },
  };
}
