import { Router } from 'express';

import { docsRouter } from './docs.routes';
import { receiptRouter } from './receipt.routes';

export const apiRouter = Router();

apiRouter.use('/docs', docsRouter);
apiRouter.use('/receipts', receiptRouter);
