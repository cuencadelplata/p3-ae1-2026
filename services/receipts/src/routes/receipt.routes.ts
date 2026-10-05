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
// RF-8.4 solo exige autenticación M1 en los endpoints de consulta/reenvío de comprobantes.
// La emisión del comprobante (RF-8.3) sigue siendo una operación del módulo y no debe
// verse bloqueada por el middleware global de M1.

receiptRouter.post('/', createReceipt);
receiptRouter.post('/resend', authenticateM1, resendReceiptWithBody);
receiptRouter.get('/:tripId', authenticateM1, getReceipt);
receiptRouter.get('/:tripId/pdf', authenticateM1, downloadReceipt);
receiptRouter.post('/:tripId/resend', authenticateM1, resendReceipt);
