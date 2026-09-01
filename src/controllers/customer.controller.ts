import { Request, Response } from 'express';
import { customerService, CustomerService } from '../services/customer.service.js';
import { CreateCustomerSchema, UpdatePreferencesSchema } from '../types/customer.js';

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
      const customer = await this.service.createCustomer(parseResult.data);
      res.status(201).json(customer);
    } catch (error: any) {
      if (error.code === '23505') {
        res.status(409).json({
          error: 'EmailAlreadyExists',
          message: 'Ya existe un cliente registrado con ese correo electrónico'
        });
        return;
      }
      res.status(500).json({ error: 'InternalServerError', message: error.message });
    }
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
   * GET /v1/customers - Listar clientes (Helper para UI)
   */
  listCustomers = async (_req: Request, res: Response): Promise<void> => {
    const customers = await this.service.getAllCustomers();
    res.status(200).json(customers);
  };
}

export const customerController = new CustomerController();
