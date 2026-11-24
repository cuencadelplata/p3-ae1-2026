import { Router } from 'express';

import {
  createReceipt,
  downloadByToken,
  downloadReceipt,
  getReceipt,
  resendReceipt,
  resendReceiptWithBody,
} from '../controllers/receipt.controller';
import { createAuthenticateM1, type IdentityValidator } from '../middlewares/auth.middleware';

export function createReceiptRouter(identityValidator?: IdentityValidator): Router {
  const receiptRouter = Router();
  const authenticateM1 = createAuthenticateM1(identityValidator);

  receiptRouter.get('/downloads/:token', downloadByToken);

  // RF-8.4 valida el Bearer contra M1 solo en consulta, descarga y reenvío.
  // La emisión del comprobante (RF-8.3) sigue siendo una operación del módulo y no debe
  // verse bloqueada por este middleware.

  receiptRouter.post('/', createReceipt);
  receiptRouter.post('/resend', authenticateM1, resendReceiptWithBody);
  receiptRouter.get('/:tripId', authenticateM1, getReceipt);
  receiptRouter.get('/:tripId/pdf', authenticateM1, downloadReceipt);
  receiptRouter.post('/:tripId/resend', authenticateM1, resendReceipt);

  return receiptRouter;
}
