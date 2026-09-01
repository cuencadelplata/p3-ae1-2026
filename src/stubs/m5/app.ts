import { randomUUID } from 'node:crypto';

import express from 'express';

export const createM5StubApp = () => {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json());
  app.get('/health', (_request, response) => response.status(200).json({ status: 'ok' }));
  app.post('/solicitudes', (_request, response) => {
    response.status(201).json({
      solicitudId: randomUUID(),
      estado: 'CREADA',
    });
  });
  return app;
};
