export interface TripProofClaims {
  tripId: string;
  customerId: string;
  driverId: string;
  status: "COMPLETED";
  completedAt: string;
  expiresAt: number;
}

export interface TripVerificationResult {
  isValid: boolean;
  claims?: TripProofClaims;
  errorMessage?: string;
}

export interface ITripVerificationService {
  /**
   * Cryptographically verifies the proof that a trip was completed by the customer with the driver.
   * Eliminates the need for cross-service database queries to TripDB.
   */
  verifyTripCompletionProof(
    proofToken: string,
    expectedCustomerId: string,
    expectedTripId: string,
    expectedDriverId: string
  ): Promise<TripVerificationResult>;
}
