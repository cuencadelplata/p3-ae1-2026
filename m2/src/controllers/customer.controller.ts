import { Request, Response } from 'express';
import { customerService, CustomerService } from '../services/customer.service.js';
import { CreateCustomerSchema, UpdatePreferencesSchema, UserIdSchema } from '../types/customer.js';
import { CustomerAlreadyExistsError } from '../errors/customer-already-exists.error.js';
import { findOwnedCustomer } from './ownership.js';
import { m1ProfileClient, M1ProfileClient } from '../clients/m1-profile.client.js';
import { logger } from '../observability/logging.js';
import type { CustomerIdentity, CustomerProfile, CustomerProfileWithIdentity } from '../types/customer.js';

/**
 * Agrega al perfil los datos personales de M1 (nombre, email, teléfono, DNI).
 * M1 solo los entrega al dueño del token: para un tercero, o si M1 no responde,
 * identity es null y el perfil se devuelve igual. No se cachean ni se guardan en M2.
 */
async function withIdentity(
  customer: CustomerProfile,
  req: Request,
  profiles: M1ProfileClient
): Promise<CustomerProfileWithIdentity> {
  const auth = req.auth;
  if (!auth || auth.userId !== customer.userId) return { ...customer, identity: null };
  try {
    const result = await profiles.getIdentity(auth.token);
    if (!result || result.userId !== customer.userId) return { ...customer, identity: null };
    const { userId: _userId, ...identity } = result;
    return { ...customer, identity: identity satisfies CustomerIdentity };
  } catch (error) {
    logger.warn({ err: error, customerId: customer.customerId }, 'm1.identity.unavailable');
    return { ...customer, identity: null };
  }
}

export class CustomerController {
  private service: CustomerService;
  private profiles: M1ProfileClient;

  constructor(service: CustomerService = customerService, profiles: M1ProfileClient = m1ProfileClient) {
    this.profiles = profiles;
    this.service = service;
  }

  /**
   * POST /v1/customers - Crear Perfil de Cliente (RF-2.1)
   */
  createCustomer = async (req: Request, res: Response): Promise<void> => {
    const parseResult = CreateCustomerSchema.safeParse(req.body);

    if (!parseResult.success) {
      res.status(400).json({
        error: 'ValidationError',
        message: 'Los datos enviados no cumplen con el esquema requerido',
        details: parseResult.error.errors
      });
      return;
    }

    try {
      // req.auth lo garantiza requireAuth; la unicidad de userId la resuelve la DB
      const customer = await this.service.createCustomer(req.auth!.userId, parseResult.data);
      res.status(201).json(customer);
    } catch (error: unknown) {
      if (!(error instanceof CustomerAlreadyExistsError)) throw error;
      res.status(409).json({
        error: 'ProfileAlreadyExists',
        message: error.message
      });
    }
  };

  /**
   * GET /v1/customers/me - Obtener mi perfil (RF-2.1)
   */
  getMe = async (req: Request, res: Response): Promise<void> => {
    const userId = req.auth!.userId;
    const customer = await this.service.getCustomerByUserId(userId);

    if (!customer) {
      res.status(404).json({
        error: 'CustomerNotFound',
        message: 'No tienes un perfil de cliente registrado'
      });
      return;
    }

    res.status(200).json(await withIdentity(customer, req, this.profiles));
  };

  /**
   * GET /v1/customers/:id - Obtener Perfil de Cliente (RF-2.1)
   */
  getCustomerById = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    const { customer, source } = await this.service.getCustomerByIdWithSource(id);

    if (!customer) {
      res.status(404).json({
        error: 'CustomerNotFound',
        message: 'No se encontró un cliente con el ID proporcionado'
      });
      return;
    }

    // X-Data-Source se refiere al perfil de M2; los datos de M1 siempre se consultan en el momento
    res.set('X-Data-Source', source).status(200).json(await withIdentity(customer, req, this.profiles));
  };

  /**
   * PUT /v1/customers/:id - Actualizar Preferencias de Cliente (RF-2.1)
   */
  updateCustomerPreferences = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    
    if (!(await findOwnedCustomer(req, res, id))) return;

    const parseResult = UpdatePreferencesSchema.safeParse(req.body);

    if (!parseResult.success) {
      res.status(400).json({
        error: 'ValidationError',
        message: 'Las preferencias enviadas no son válidas',
        details: parseResult.error.errors
      });
      return;
    }

    const updated = await this.service.updatePreferences(id, parseResult.data);
    if (!updated) {
      res.status(404).json({
        error: 'CustomerNotFound',
        message: 'No se encontró un cliente con el ID proporcionado para actualizar'
      });
      return;
    }

    res.status(200).json({
      customerId: updated.customerId,
      preferences: updated.preferences,
      status: updated.status
    });
  };

  /**
   * GET /v1/customers - Listar clientes (Helper para UI y M8)
   */
  listCustomers = async (req: Request, res: Response): Promise<void> => {
    if (req.query.userId) {
      const userId = UserIdSchema.safeParse(Number(req.query.userId));
      if (!userId.success) {
        res.status(400).json({ error: 'BadRequest', message: 'userId debe ser un entero positivo' });
        return;
      }
      const customer = await this.service.getCustomerByUserId(userId.data);
      res.status(200).json(customer ? [customer] : []);
      return;
    }

    const customers = await this.service.getAllCustomers();
    res.status(200).json(customers);
  };
}

export const customerController = new CustomerController();
