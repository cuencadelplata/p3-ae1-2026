export interface EventStore {
  isEventProcessed(eventId: string): Promise<boolean>;
  markEventProcessed(eventId: string, ttlSeconds?: number): Promise<void>;
}
