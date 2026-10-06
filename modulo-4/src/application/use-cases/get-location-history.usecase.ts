import type { LocationHistoryResponse } from '../../domain/entities/location.entity.js';
import type { LocationHistoryRepository } from '../../ports/location-repository.port.js';

export class GetLocationHistoryUseCase {
  public constructor(private readonly historyRepository: LocationHistoryRepository) {}

  public async execute(driverId: number, limit = 20): Promise<LocationHistoryResponse> {
    const entries = await this.historyRepository.getHistoryByDriver(driverId, limit);
    return {
      count: entries.length,
      entries
    };
  }
}
