import { customerRepository, CustomerRepository } from '../repositories/customer.repository.js';
import type {
  CreateCustomerDTO,
  CustomerProfile,
  UpdatePreferencesDTO,
  AccountStatusResponse,
  CustomerTripsResponse
} from '../types/customer.js';

export class CustomerService {
  private repository: CustomerRepository;
  private m6ServiceUrl: string;

  constructor(repository: CustomerRepository = customerRepository) {
    this.repository = repository;
    this.m6ServiceUrl = process.env.M6_SERVICE_URL || 'http://localhost:8080';
  }

  /**
   * RF-2.1: Crear nuevo perfil de cliente
   */
  async createCustomer(dto: CreateCustomerDTO): Promise<CustomerProfile> {
    const randomHex = Math.random().toString(16).substring(2, 10);
    const newCustomer: CustomerProfile = {
      customerId: `cust_${randomHex}`,
      name: dto.name,
      email: dto.email,
      phone: dto.phone,
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
    return await this.repository.findById(customerId);
  }

  /**
   * RF-2.1: Actualizar preferencias de un cliente
   */
  async updatePreferences(customerId: string, dto: UpdatePreferencesDTO): Promise<CustomerProfile | null> {
    const exists = await this.repository.findById(customerId);
    if (!exists) return null;

    return await this.repository.updatePreferences(customerId, dto.preferences);
  }

  /**
   * RF-2.5: Consultar estado de cuenta y bloqueos
   */
  async getAccountStatus(customerId: string): Promise<AccountStatusResponse | null> {
    const exists = await this.repository.findById(customerId);
    if (!exists) return null;

    return await this.repository.findAccountStatus(customerId);
  }

  /**
   * RF-2.3: Historial de Viajes (Consumo síncrono HTTP a M6 o Stub)
   */
  async getCustomerTrips(customerId: string): Promise<CustomerTripsResponse | null> {
    const customer = await this.repository.findById(customerId);
    if (!customer) return null;

    try {
      const response = await fetch(`${this.m6ServiceUrl}/v1/trips?customerId=${encodeURIComponent(customerId)}`);
      if (response.ok) {
        return (await response.json()) as CustomerTripsResponse;
      }
    } catch (error: any) {
      console.warn(`[CustomerService] Fallback al Stub M6: No se pudo contactar a ${this.m6ServiceUrl} (${error.message})`);
    }

    // Fallback de demostración si M6 no está disponible
    return {
      customerId,
      tripsCount: 2,
      trips: [
        {
          tripId: 'trip_99217c2f',
          origin: 'Av. Colón 1200, Córdoba',
          destination: 'Av. General Paz 250, Córdoba',
          fare: 1850.0,
          status: 'COMPLETADO',
          createdAt: '2026-08-29T14:20:00Z'
        },
        {
          tripId: 'trip_88201a4e',
          origin: 'Plaza España, Córdoba',
          destination: 'Aeropuerto Córdoba',
          fare: 5200.0,
          status: 'COMPLETADO',
          createdAt: '2026-08-28T09:15:00Z'
        }
      ]
    };
  }

  /**
   * Listar todos los clientes
   */
  async getAllCustomers(): Promise<CustomerProfile[]> {
    return await this.repository.findAll();
  }
}

export const customerService = new CustomerService();
