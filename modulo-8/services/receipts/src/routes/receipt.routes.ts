import { Router } from 'express';

import {
  createReceipt,
  downloadByToken,
  downloadReceipt,
  getReceipt,
  resendReceipt,
  resendReceiptWithBody,
} from '../controllers/receipt.controller';
import { authenticateM1 } from '../middlewares/auth.middleware';

export const receiptRouter = Router();

receiptRouter.get('/downloads/:token', downloadByToken);

// Middleware de autenticacion M1 (evalua tokens Bearer de M1 y aplica authRequired)
receiptRouter.use(authenticateM1);

receiptRouter.post('/', createReceipt);
receiptRouter.post('/resend', resendReceiptWithBody);
receiptRouter.get('/:tripId', getReceipt);
receiptRouter.get('/:tripId/pdf', downloadReceipt);
receiptRouter.post('/:tripId/resend', resendReceipt);

