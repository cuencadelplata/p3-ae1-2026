import { Customer } from "../../domain/entities/Customer.js";
import { CustomerId } from "../../domain/value-objects/Identifiers.js";
import { ICustomerRepository } from "../../domain/ports/ICustomerRepository.js";

export class InMemoryCustomerRepository implements ICustomerRepository {
  private readonly customers: Map<string, Customer> = new Map();

  public async findById(id: CustomerId): Promise<Customer | null> {
    return this.customers.get(id.value.toLowerCase()) ?? null;
  }

  public async save(customer: Customer): Promise<void> {
    this.customers.set(customer.id.value.toLowerCase(), customer);
  }

  public clear(): void {
    this.customers.clear();
  }
}
