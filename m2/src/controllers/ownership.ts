import type { Request, Response } from 'express';
import { customerService } from '../services/customer.service.js';
import type { CustomerProfile } from '../types/customer.js';

export async function findOwnedCustomer(
  req: Request, res: Response, customerId: string
): Promise<CustomerProfile | null> {
  const customer = await customerService.getCustomerById(customerId);
  if (!customer) {
    res.status(404).json({ error: 'CustomerNotFound', message: 'No se encontró un cliente con el ID proporcionado' });
    return null;
  }
  if (customer.userId !== req.auth?.userId) {
    res.status(403).json({ error: 'Forbidden', message: 'No tenés permiso sobre este perfil' });
    return null;
  }
  return customer;
}
