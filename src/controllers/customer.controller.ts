import { Request, Response } from 'express';
import { customerService, CustomerService } from '../services/customer.service.js';
import { CreateCustomerSchema, UpdatePreferencesSchema, UpdateAccountStatusSchema, UserIdSchema } from '../types/customer.js';
import { CustomerAlreadyExistsError } from '../errors/customer-already-exists.error.js';

export class CustomerController {
  private service: CustomerService;

  constructor(service: CustomerService = customerService) {
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

    res.status(200).json(customer);
  };

  /**
   * GET /v1/customers/:id - Obtener Perfil de Cliente (RF-2.1)
   */
  getCustomerById = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    const customer = await this.service.getCustomerById(id);

    if (!customer) {
      res.status(404).json({
        error: 'CustomerNotFound',
        message: 'No se encontró un cliente con el ID proporcionado'
      });
      return;
    }

    res.status(200).json(customer);
  };

  /**
   * PUT /v1/customers/:id - Actualizar Preferencias de Cliente (RF-2.1)
   */
  updateCustomerPreferences = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    
    // Check ownership
    const customer = await this.service.getCustomerById(id);
    if (!customer) {
      res.status(404).json({
        error: 'CustomerNotFound',
        message: 'No se encontró un cliente con el ID proporcionado para actualizar'
      });
      return;
    }

    if (customer.userId !== req.auth!.userId) {
      res.status(403).json({
        error: 'Forbidden',
        message: 'No tienes permiso para modificar este perfil'
      });
      return;
    }

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
   * GET /v1/customers/:id/status - Consultar Estado de Cuenta (RF-2.5)
   */
  getAccountStatus = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    const statusInfo = await this.service.getAccountStatus(id);

    if (!statusInfo) {
      res.status(404).json({
        error: 'CustomerNotFound',
        message: 'No se encontró un cliente con el ID proporcionado'
      });
      return;
    }

    res.status(200).json(statusInfo);
  };

  /**
   * PUT /v1/customers/:id/status - Cambiar Estado de Cuenta (RF-2.5)
   * Reemplaza al borrado: la baja de un cliente se registra con status INACTIVO.
   */
  updateAccountStatus = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    const parseResult = UpdateAccountStatusSchema.safeParse(req.body);

    if (!parseResult.success) {
      res.status(400).json({
        error: 'ValidationError',
        message: 'El estado enviado no es válido',
        details: parseResult.error.errors
      });
      return;
    }

    try {
      const updated = await this.service.updateAccountStatus(id, parseResult.data);
      if (!updated) {
        res.status(404).json({
          error: 'CustomerNotFound',
          message: 'No se encontró un cliente con el ID proporcionado para actualizar'
        });
        return;
      }

      res.status(200).json(updated);
    } catch (error: any) {
      res.status(500).json({ error: 'InternalServerError', message: error.message });
    }
  };

  /**
   * GET /v1/customers/:id/trips - Consultar Historial de Viajes (RF-2.3)
   */
  getCustomerTrips = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    const trips = await this.service.getCustomerTrips(id);

    if (!trips) {
      res.status(404).json({
        error: 'CustomerNotFound',
        message: 'No se encontró un cliente con el ID proporcionado'
      });
      return;
    }

    res.status(200).json(trips);
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
