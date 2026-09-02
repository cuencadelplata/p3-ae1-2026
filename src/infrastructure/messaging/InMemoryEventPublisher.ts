import { DriverRatingSubmittedEvent } from "../../domain/events/DriverRatingSubmittedEvent.js";
import { IEventPublisher } from "../../domain/ports/IEventPublisher.js";

export class InMemoryEventPublisher implements IEventPublisher {
  public readonly publishedEvents: DriverRatingSubmittedEvent[] = [];

  public async publish(event: DriverRatingSubmittedEvent): Promise<void> {
    this.publishedEvents.push(event);
  }

  public getEvents(): DriverRatingSubmittedEvent[] {
    return [...this.publishedEvents];
  }

  public clear(): void {
    this.publishedEvents.length = 0;
  }
}
