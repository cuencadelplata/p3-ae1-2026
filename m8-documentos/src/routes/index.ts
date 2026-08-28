import { Router } from 'express';

import { receiptRouter } from './receipt.routes';

export const apiRouter = Router();

apiRouter.use('/receipts', receiptRouter);
