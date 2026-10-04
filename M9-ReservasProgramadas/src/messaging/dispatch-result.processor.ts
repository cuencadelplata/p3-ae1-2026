import type { DispatchResultEvent } from './reservation-events.js';

export type DispatchResultProcessing = 'PROCESSED' | 'DUPLICATE' | 'IGNORED';

export interface DispatchResultProcessor {
  process(event: DispatchResultEvent): Promise<DispatchResultProcessing>;
}
