import { CustomerRating } from "../../domain/entities/CustomerRating.js";
import { RatingId, CustomerId, TripId } from "../../domain/value-objects/Identifiers.js";
import { ICustomerRatingRepository } from "../../domain/ports/ICustomerRatingRepository.js";

export class InMemoryCustomerRatingRepository implements ICustomerRatingRepository {
  private readonly ratings: Map<string, CustomerRating> = new Map();

  public async save(rating: CustomerRating): Promise<void> {
    this.ratings.set(rating.id.value, rating);
  }

  public async findByCustomerAndTrip(customerId: CustomerId, tripId: TripId): Promise<CustomerRating | null> {
    for (const rating of this.ratings.values()) {
      if (
        rating.customerId.value.toLowerCase() === customerId.value.toLowerCase() &&
        rating.tripId.value.toLowerCase() === tripId.value.toLowerCase()
      ) {
        return rating;
      }
    }
    return null;
  }

  public async findById(id: RatingId): Promise<CustomerRating | null> {
    return this.ratings.get(id.value) ?? null;
  }

  public async findByCustomerId(customerId: CustomerId): Promise<CustomerRating[]> {
    const results: CustomerRating[] = [];
    for (const rating of this.ratings.values()) {
      if (rating.customerId.value.toLowerCase() === customerId.value.toLowerCase()) {
        results.push(rating);
      }
    }
    return results;
  }

  public clear(): void {
    this.ratings.clear();
  }

  public getAll(): CustomerRating[] {
    return Array.from(this.ratings.values());
  }
}
