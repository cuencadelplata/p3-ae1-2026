import { CustomerRating } from "../../domain/entities/CustomerRating.js";
import { CustomerId, TripId, DriverId } from "../../domain/value-objects/Identifiers.js";
import { Score } from "../../domain/value-objects/Score.js";
import { Comment } from "../../domain/value-objects/Comment.js";
import { ICustomerRatingRepository } from "../../domain/ports/ICustomerRatingRepository.js";
import { ICustomerRepository } from "../../domain/ports/ICustomerRepository.js";
import { ITripVerificationService } from "../../domain/ports/ITripVerificationService.js";
import { IEventPublisher } from "../../domain/ports/IEventPublisher.js";
import {
  CustomerNotFoundError,
  CustomerInactiveError,
  DuplicateTripRatingError,
  InvalidTripProofError,
} from "../../domain/errors/DomainErrors.js";
import { CreateRatingInputDTO, RatingOutputDTO } from "../dtos/RatingDTOs.js";

export interface CreateCustomerRatingDependencies {
  customerRatingRepository: ICustomerRatingRepository;
  customerRepository: ICustomerRepository;
  tripVerificationService?: ITripVerificationService;
  eventPublisher?: IEventPublisher;
}

export class CreateCustomerRatingUseCase {
  private readonly customerRatingRepo: ICustomerRatingRepository;
  private readonly customerRepo: ICustomerRepository;
  private readonly tripVerificationService?: ITripVerificationService;
  private readonly eventPublisher?: IEventPublisher;

  constructor(deps: CreateCustomerRatingDependencies) {
    this.customerRatingRepo = deps.customerRatingRepository;
    this.customerRepo = deps.customerRepository;
    this.tripVerificationService = deps.tripVerificationService;
    this.eventPublisher = deps.eventPublisher;
  }

  public async execute(input: CreateRatingInputDTO): Promise<RatingOutputDTO> {
    // 1. Validar formato de Identificadores (Value Objects)
    const customerId = CustomerId.fromString(input.customerId);
    const tripId = TripId.fromString(input.tripId);
    const driverId = DriverId.fromString(input.driverId);

    // 2. Validar existencia y estado del cliente en CustomerDB (Aislamiento de datos M2)
    const customer = await this.customerRepo.findById(customerId);
    if (!customer) {
      throw new CustomerNotFoundError(customerId.value);
    }
    if (!customer.isActive) {
      throw new CustomerInactiveError(customerId.value);
    }

    // 3. Validar que no exista calificación previa para este viaje en CustomerDB (Regla de unicidad)
    const existingRating = await this.customerRatingRepo.findByCustomerAndTrip(customerId, tripId);
    if (existingRating) {
      throw new DuplicateTripRatingError(tripId.value, customerId.value);
    }

    // 4. Validar desacopladamente la prueba de viaje completado (Trip Completion Proof) si el verificador está activo
    if (this.tripVerificationService && input.tripCompletionProof) {
      const verification = await this.tripVerificationService.verifyTripCompletionProof(
        input.tripCompletionProof,
        customerId.value,
        tripId.value,
        driverId.value
      );

      if (!verification.isValid) {
        throw new InvalidTripProofError(verification.errorMessage ?? "Firma o datos de viaje no válidos");
      }
    }

    // 5. Validar invariantes de Dominio (Score 1..5, Comment max 500) y crear Aggregate
    const score = Score.create(input.score);
    const comment = Comment.create(input.comment);

    const rating = CustomerRating.create({
      customerId,
      tripId,
      driverId,
      score,
      comment,
    });

    // 6. Persistir en CustomerDB
    await this.customerRatingRepo.save(rating);

    // 7. Publicar eventos de dominio para actualización asíncrona de M3 (Driver Service)
    const events = rating.pullDomainEvents();
    if (this.eventPublisher) {
      for (const event of events) {
        await this.eventPublisher.publish(event);
      }
    }

    // 8. Retornar DTO de salida
    return {
      id: rating.id.value,
      customerId: rating.customerId.value,
      tripId: rating.tripId.value,
      driverId: rating.driverId.value,
      score: rating.score.value,
      comment: rating.comment.value ?? null,
      createdAt: rating.createdAt.toISOString(),
      updatedAt: rating.updatedAt.toISOString(),
    };
  }
}
