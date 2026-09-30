import { Router } from 'express';

import {
  createReceipt,
  downloadByToken,
  downloadReceipt,
  getReceipt,
  resendReceipt,
} from '../controllers/receipt.controller';

export const receiptRouter = Router();

receiptRouter.post('/', createReceipt);
receiptRouter.get('/downloads/:token', downloadByToken);
receiptRouter.get('/:tripId', getReceipt);
receiptRouter.get('/:tripId/pdf', downloadReceipt);
receiptRouter.post('/:tripId/resend', resendReceipt);
