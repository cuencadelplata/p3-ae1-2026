import { RatingId, CustomerId, TripId, DriverId } from "../value-objects/Identifiers.js";
import { Score } from "../value-objects/Score.js";
import { Comment } from "../value-objects/Comment.js";
import { DriverRatingSubmittedEvent } from "../events/DriverRatingSubmittedEvent.js";

export interface CreateCustomerRatingProps {
  id?: RatingId;
  customerId: CustomerId;
  tripId: TripId;
  driverId: DriverId;
  score: Score;
  comment?: Comment;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface ReconstituteCustomerRatingProps {
  id: string;
  customerId: string;
  tripId: string;
  driverId: string;
  score: number;
  comment?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export class CustomerRating {
  private readonly _id: RatingId;
  private readonly _customerId: CustomerId;
  private readonly _tripId: TripId;
  private readonly _driverId: DriverId;
  private readonly _score: Score;
  private readonly _comment: Comment;
  private readonly _createdAt: Date;
  private readonly _updatedAt: Date;
  private readonly _domainEvents: DriverRatingSubmittedEvent[] = [];

  private constructor(props: CreateCustomerRatingProps) {
    this._id = props.id ?? RatingId.create();
    this._customerId = props.customerId;
    this._tripId = props.tripId;
    this._driverId = props.driverId;
    this._score = props.score;
    this._comment = props.comment ?? Comment.create(undefined);
    this._createdAt = props.createdAt ?? new Date();
    this._updatedAt = props.updatedAt ?? new Date();
  }

  /**
   * Factory method to create a new CustomerRating in the domain.
   * Emits a DriverRatingSubmittedEvent for asynchronous distribution to M3 (Driver Module).
   */
  public static create(props: {
    id?: RatingId;
    customerId: CustomerId;
    tripId: TripId;
    driverId: DriverId;
    score: Score;
    comment?: Comment;
  }): CustomerRating {
    const rating = new CustomerRating(props);

    rating._domainEvents.push(
      new DriverRatingSubmittedEvent({
        ratingId: rating._id.value,
        customerId: rating._customerId.value,
        tripId: rating._tripId.value,
        driverId: rating._driverId.value,
        score: rating._score.value,
        comment: rating._comment.value,
        submittedAt: rating._createdAt.toISOString(),
      }, rating._createdAt)
    );

    return rating;
  }

  /**
   * Reconstitutes an existing entity from persistence storage (CustomerDB).
   */
  public static reconstitute(props: ReconstituteCustomerRatingProps): CustomerRating {
    return new CustomerRating({
      id: RatingId.fromString(props.id),
      customerId: CustomerId.fromString(props.customerId),
      tripId: TripId.fromString(props.tripId),
      driverId: DriverId.fromString(props.driverId),
      score: Score.create(props.score),
      comment: Comment.create(props.comment),
      createdAt: props.createdAt,
      updatedAt: props.updatedAt,
    });
  }

  public get id(): RatingId {
    return this._id;
  }

  public get customerId(): CustomerId {
    return this._customerId;
  }

  public get tripId(): TripId {
    return this._tripId;
  }

  public get driverId(): DriverId {
    return this._driverId;
  }

  public get score(): Score {
    return this._score;
  }

  public get comment(): Comment {
    return this._comment;
  }

  public get createdAt(): Date {
    return this._createdAt;
  }

  public get updatedAt(): Date {
    return this._updatedAt;
  }

  public pullDomainEvents(): DriverRatingSubmittedEvent[] {
    const events = [...this._domainEvents];
    this._domainEvents.length = 0;
    return events;
  }
}
