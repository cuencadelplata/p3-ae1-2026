import { Router } from 'express';

import { getDeliveryReference } from '../controllers/receipt.controller';

/** Contratos internos entre servicios de M8. No forman parte de la OpenAPI publica. */
export const internalRouter = Router();

internalRouter.get('/receipts/:tripId/delivery-reference', getDeliveryReference);
