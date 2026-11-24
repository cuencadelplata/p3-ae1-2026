import { customerRepository, CustomerRepository } from '../repositories/customer.repository.js';
import { customerCache, CustomerCache } from '../cache/customer.cache.js';
import type {
  CreateCustomerDTO,
  CustomerProfile,
  UpdatePreferencesDTO,
  UserId
} from '../types/customer.js';

export class CustomerService {
  private repository: CustomerRepository;
  constructor(repository: CustomerRepository = customerRepository, private readonly cache: CustomerCache = customerCache) {
    this.repository = repository;
  }

  /**
   * RF-2.1: Crear nuevo perfil de cliente
   */
  async createCustomer(userId: UserId, dto: CreateCustomerDTO): Promise<CustomerProfile> {
    const randomHex = Math.random().toString(16).substring(2, 10);
    const newCustomer: CustomerProfile = {
      customerId: `cust_${randomHex}`,
      userId,
      preferences: dto.preferences,
      status: 'ACTIVO',
      createdAt: new Date().toISOString()
    };

    return await this.repository.create(newCustomer);
  }

  /**
   * RF-2.1: Obtener perfil por ID
   */
  async getCustomerById(customerId: string): Promise<CustomerProfile | null> {
    return (await this.getCustomerByIdWithSource(customerId)).customer;
  }

  async getCustomerByIdWithSource(customerId: string): Promise<{
    readonly customer: CustomerProfile | null;
    readonly source: 'cache' | 'database';
  }> {
    const cached = await this.cache.get(customerId);
    if (cached) return { customer: cached, source: 'cache' };
    const customer = await this.repository.findById(customerId);
    if (customer) await this.cache.set(customerId, customer);
    return { customer, source: 'database' };
  }

  /**
   * RF-2.1: Obtener perfil por User ID (de M1)
   */
  async getCustomerByUserId(userId: UserId): Promise<CustomerProfile | null> {
    return await this.repository.findByUserId(userId);
  }

  /**
   * RF-2.1: Actualizar preferencias de un cliente
   */
  async updatePreferences(customerId: string, dto: UpdatePreferencesDTO): Promise<CustomerProfile | null> {
    const exists = await this.repository.findById(customerId);
    if (!exists) return null;

    const updated = await this.repository.updatePreferences(customerId, dto.preferences);
    if (updated) await this.cache.invalidate(customerId);
    return updated;
  }

  /**
   * Listar todos los clientes
   */
  async getAllCustomers(): Promise<CustomerProfile[]> {
    return await this.repository.findAll();
  }
}

export const customerService = new CustomerService();
