import type { Coordinates, DistanceEstimate } from '../../domain/entities/location.entity.js';
import { DistanceCalculator } from '../../domain/services/distance.calculator.js';

export interface EstimateInput {
  origin: Coordinates;
  destination: Coordinates;
}

export class EstimateDistanceEtaUseCase {
  public execute(input: EstimateInput): DistanceEstimate {
    return DistanceCalculator.estimate(input.origin, input.destination);
  }
}
