import { randomUUID } from "node:crypto";
import { InvalidUuidError } from "../errors/DomainErrors.js";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export abstract class UuidValueObject {
  protected readonly _value: string;

  protected constructor(value: string, fieldName: string) {
    if (!value || !UUID_REGEX.test(value)) {
      throw new InvalidUuidError(fieldName, value);
    }
    this._value = value.toLowerCase();
  }

  public get value(): string {
    return this._value;
  }

  public equals(other: UuidValueObject): boolean {
    if (!other || this.constructor !== other.constructor) {
      return false;
    }
    return this._value === other._value;
  }

  public toString(): string {
    return this._value;
  }
}

export class RatingId extends UuidValueObject {
  private constructor(value: string) {
    super(value, "ratingId");
  }

  public static create(value?: string): RatingId {
    return new RatingId(value ?? randomUUID());
  }

  public static fromString(value: string): RatingId {
    return new RatingId(value);
  }
}

export class CustomerId extends UuidValueObject {
  private constructor(value: string) {
    super(value, "customerId");
  }

  public static create(value?: string): CustomerId {
    return new CustomerId(value ?? randomUUID());
  }

  public static fromString(value: string): CustomerId {
    return new CustomerId(value);
  }
}

export class TripId extends UuidValueObject {
  private constructor(value: string) {
    super(value, "tripId");
  }

  public static create(value?: string): TripId {
    return new TripId(value ?? randomUUID());
  }

  public static fromString(value: string): TripId {
    return new TripId(value);
  }
}

export class DriverId extends UuidValueObject {
  private constructor(value: string) {
    super(value, "driverId");
  }

  public static create(value?: string): DriverId {
    return new DriverId(value ?? randomUUID());
  }

  public static fromString(value: string): DriverId {
    return new DriverId(value);
  }
}
