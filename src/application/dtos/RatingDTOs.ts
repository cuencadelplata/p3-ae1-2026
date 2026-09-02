export interface CreateRatingInputDTO {
  customerId: string;
  tripId: string;
  driverId: string;
  score: number;
  comment?: string | null;
  tripCompletionProof?: string;
}

export interface RatingOutputDTO {
  id: string;
  customerId: string;
  tripId: string;
  driverId: string;
  score: number;
  comment: string | null;
  createdAt: string;
  updatedAt: string;
}
