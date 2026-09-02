export interface DriverRatingSubmittedEventPayload {
  ratingId: string;
  customerId: string;
  tripId: string;
  driverId: string;
  score: number;
  comment?: string;
  submittedAt: string;
}

export class DriverRatingSubmittedEvent {
  public static readonly EVENT_NAME = "customer.driver-rating.submitted";

  public readonly eventName = DriverRatingSubmittedEvent.EVENT_NAME;
  public readonly occurredOn: Date;
  public readonly payload: DriverRatingSubmittedEventPayload;

  constructor(payload: DriverRatingSubmittedEventPayload, occurredOn: Date = new Date()) {
    this.payload = payload;
    this.occurredOn = occurredOn;
  }
}
