import { DriverRatingSubmittedEvent } from "../events/DriverRatingSubmittedEvent.js";

export interface IEventPublisher {
  /**
   * Publishes domain events to the message broker (e.g. Kafka / RabbitMQ)
   * for asynchronous consumption by other services (such as Driver Service M3).
   */
  publish(event: DriverRatingSubmittedEvent): Promise<void>;
}
