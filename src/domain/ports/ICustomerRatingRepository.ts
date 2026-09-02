import { CustomerRating } from "../entities/CustomerRating.js";
import { RatingId, CustomerId, TripId } from "../value-objects/Identifiers.js";

export interface ICustomerRatingRepository {
  /**
   * Persists a CustomerRating aggregate into CustomerDB.
   */
  save(rating: CustomerRating): Promise<void>;

  /**
   * Finds a rating given a customer ID and trip ID.
   * Useful for checking duplicate reviews within M2's own database.
   */
  findByCustomerAndTrip(customerId: CustomerId, tripId: TripId): Promise<CustomerRating | null>;

  /**
   * Retrieves a rating by its unique ID.
   */
  findById(id: RatingId): Promise<CustomerRating | null>;

  /**
   * Retrieves all ratings submitted by a specific customer.
   */
  findByCustomerId(customerId: CustomerId): Promise<CustomerRating[]>;
}
