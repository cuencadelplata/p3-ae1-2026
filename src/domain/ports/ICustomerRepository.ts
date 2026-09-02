import { Customer } from "../entities/Customer.js";
import { CustomerId } from "../value-objects/Identifiers.js";

export interface ICustomerRepository {
  /**
   * Retrieves a customer by their unique ID within CustomerDB.
   */
  findById(id: CustomerId): Promise<Customer | null>;

  /**
   * Persists or updates a customer in CustomerDB.
   */
  save(customer: Customer): Promise<void>;
}
