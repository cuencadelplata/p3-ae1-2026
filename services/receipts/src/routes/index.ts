import { Router } from 'express';

import type { IdentityValidator } from '../middlewares/auth.middleware';
import { docsRouter } from './docs.routes';
import { createReceiptRouter } from './receipt.routes';

export function createApiRouter(identityValidator?: IdentityValidator): Router {
  const apiRouter = Router();

  apiRouter.use('/docs', docsRouter);
  apiRouter.use('/receipts', createReceiptRouter(identityValidator));

  return apiRouter;
}
