import type { M1UserValidationResponse } from '../domain/entities/location.entity.js';

export interface AuthService {
  validateConductorIdentity(token: string, targetDriverId: number): Promise<M1UserValidationResponse>;
}
