import { Router } from 'express';

import {
  createReceipt,
  downloadReceipt,
  getReceipt,
  resendReceipt,
} from '../controllers/receipt.controller';

export const receiptRouter = Router();

receiptRouter.post('/', createReceipt);
receiptRouter.get('/:tripId', getReceipt);
receiptRouter.get('/:tripId/pdf', downloadReceipt);
receiptRouter.post('/:tripId/resend', resendReceipt);
