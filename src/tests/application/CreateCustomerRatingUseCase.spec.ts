import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { CreateCustomerRatingUseCase } from "../../application/use-cases/CreateCustomerRatingUseCase.js";
import { InMemoryCustomerRatingRepository } from "../../infrastructure/persistence/InMemoryCustomerRatingRepository.js";
import { InMemoryCustomerRepository } from "../../infrastructure/persistence/InMemoryCustomerRepository.js";
import { InMemoryEventPublisher } from "../../infrastructure/messaging/InMemoryEventPublisher.js";
import { HmacTripVerificationService } from "../../infrastructure/security/HmacTripVerificationService.js";
import { Customer } from "../../domain/entities/Customer.js";
import { CustomerId } from "../../domain/value-objects/Identifiers.js";
import {
  CustomerNotFoundError,
  CustomerInactiveError,
  DuplicateTripRatingError,
  InvalidRatingScoreError,
  InvalidTripProofError,
} from "../../domain/errors/DomainErrors.js";
import { DriverRatingSubmittedEvent } from "../../domain/events/DriverRatingSubmittedEvent.js";

describe("CreateCustomerRatingUseCase - Application Layer", () => {
  let ratingRepo: InMemoryCustomerRatingRepository;
  let customerRepo: InMemoryCustomerRepository;
  let eventPublisher: InMemoryEventPublisher;
  let tripVerifier: HmacTripVerificationService;
  let useCase: CreateCustomerRatingUseCase;

  const validCustomerId = "11111111-1111-4111-8111-111111111111";
  const validTripId = "22222222-2222-4222-8222-222222222222";
  const validDriverId = "33333333-3333-4333-8333-333333333333";

  beforeEach(() => {
    ratingRepo = new InMemoryCustomerRatingRepository();
    customerRepo = new InMemoryCustomerRepository();
    eventPublisher = new InMemoryEventPublisher();
    tripVerifier = new HmacTripVerificationService("test-secret-key");

    useCase = new CreateCustomerRatingUseCase({
      customerRatingRepository: ratingRepo,
      customerRepository: customerRepo,
      tripVerificationService: tripVerifier,
      eventPublisher: eventPublisher,
    });

    // Registrar cliente de prueba activo en CustomerDB
    const activeCustomer = new Customer({
      id: CustomerId.fromString(validCustomerId),
      firstName: "Carlos",
      lastName: "Gómez",
      email: "carlos.gomez@example.com",
      phoneNumber: "+5491112345678",
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    customerRepo.save(activeCustomer);
  });

  it("debe registrar exitosamente una calificación válida y publicar el evento de dominio asíncrono", async () => {
    const proofToken = tripVerifier.generateProofToken({
      tripId: validTripId,
      customerId: validCustomerId,
      driverId: validDriverId,
      status: "COMPLETED",
      completedAt: new Date().toISOString(),
    });

    const result = await useCase.execute({
      customerId: validCustomerId,
      tripId: validTripId,
      driverId: validDriverId,
      score: 5,
      comment: "Excelente servicio, llegó a tiempo.",
      tripCompletionProof: proofToken,
    });

    // Validar DTO de respuesta
    assert.ok(result.id);
    assert.equal(result.customerId, validCustomerId);
    assert.equal(result.tripId, validTripId);
    assert.equal(result.driverId, validDriverId);
    assert.equal(result.score, 5);
    assert.equal(result.comment, "Excelente servicio, llegó a tiempo.");
    assert.ok(result.createdAt);

    // Validar persistencia exclusiva en CustomerDB
    const saved = await ratingRepo.findById({ value: result.id } as any);
    assert.ok(saved);
    assert.equal(saved?.score.value, 5);

    // Validar publicación del evento asíncrono hacia Driver Service (M3)
    const publishedEvents = eventPublisher.getEvents();
    assert.equal(publishedEvents.length, 1);
    assert.equal(publishedEvents[0].eventName, DriverRatingSubmittedEvent.EVENT_NAME);
    assert.equal(publishedEvents[0].payload.driverId, validDriverId);
    assert.equal(publishedEvents[0].payload.score, 5);
  });

  it("debe rechazar la calificación si el cliente no existe en CustomerDB (Aislamiento de datos)", async () => {
    const nonExistentCustomerId = "99999999-9999-4999-8999-999999999999";

    await assert.rejects(
      () =>
        useCase.execute({
          customerId: nonExistentCustomerId,
          tripId: validTripId,
          driverId: validDriverId,
          score: 4,
        }),
      (err: any) => {
        assert.ok(err instanceof CustomerNotFoundError);
        assert.equal(err.code, "CUSTOMER_NOT_FOUND");
        return true;
      }
    );
  });

  it("debe rechazar la calificación si el cliente está inactivo en CustomerDB", async () => {
    const inactiveCustomerId = "88888888-8888-4888-8888-888888888888";
    const inactiveCustomer = new Customer({
      id: CustomerId.fromString(inactiveCustomerId),
      firstName: "Juan",
      lastName: "Pérez",
      email: "juan.perez@example.com",
      phoneNumber: "+5491187654321",
      isActive: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await customerRepo.save(inactiveCustomer);

    await assert.rejects(
      () =>
        useCase.execute({
          customerId: inactiveCustomerId,
          tripId: validTripId,
          driverId: validDriverId,
          score: 4,
        }),
      (err: any) => {
        assert.ok(err instanceof CustomerInactiveError);
        assert.equal(err.code, "CUSTOMER_INACTIVE");
        return true;
      }
    );
  });

  it("debe rechazar calificaciones duplicadas para un mismo viaje (Regla de unicidad RF-2.4)", async () => {
    // Primera calificación exitosa
    await useCase.execute({
      customerId: validCustomerId,
      tripId: validTripId,
      driverId: validDriverId,
      score: 4,
      comment: "Primer registro",
    });

    // Intento de segunda calificación para el mismo viaje
    await assert.rejects(
      () =>
        useCase.execute({
          customerId: validCustomerId,
          tripId: validTripId,
          driverId: validDriverId,
          score: 5,
          comment: "Intento duplicado",
        }),
      (err: any) => {
        assert.ok(err instanceof DuplicateTripRatingError);
        assert.equal(err.code, "DUPLICATE_TRIP_RATING");
        return true;
      }
    );
  });

  it("debe rechazar puntuaciones inválidas fuera del rango 1 a 5", async () => {
    await assert.rejects(
      () =>
        useCase.execute({
          customerId: validCustomerId,
          tripId: validTripId,
          driverId: validDriverId,
          score: 0,
        }),
      (err: any) => {
        assert.ok(err instanceof InvalidRatingScoreError);
        return true;
      }
    );

    await assert.rejects(
      () =>
        useCase.execute({
          customerId: validCustomerId,
          tripId: validTripId,
          driverId: validDriverId,
          score: 6,
        }),
      (err: any) => {
        assert.ok(err instanceof InvalidRatingScoreError);
        return true;
      }
    );
  });

  it("debe rechazar si la prueba de viaje (TripCompletionProof) tiene firma inválida o adulterada", async () => {
    const tamperedProofToken = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.adulterado_payload.fake_signature";

    await assert.rejects(
      () =>
        useCase.execute({
          customerId: validCustomerId,
          tripId: validTripId,
          driverId: validDriverId,
          score: 5,
          tripCompletionProof: tamperedProofToken,
        }),
      (err: any) => {
        assert.ok(err instanceof InvalidTripProofError);
        return true;
      }
    );
  });

  it("debe rechazar si la prueba de viaje pertenece a otro viaje o a otro conductor", async () => {
    const anotherTripId = "77777777-7777-4777-8777-777777777777";
    const proofTokenForAnotherTrip = tripVerifier.generateProofToken({
      tripId: anotherTripId,
      customerId: validCustomerId,
      driverId: validDriverId,
      status: "COMPLETED",
      completedAt: new Date().toISOString(),
    });

    await assert.rejects(
      () =>
        useCase.execute({
          customerId: validCustomerId,
          tripId: validTripId, // Petición indica un viaje diferente al del token firmado
          driverId: validDriverId,
          score: 5,
          tripCompletionProof: proofTokenForAnotherTrip,
        }),
      (err: any) => {
        assert.ok(err instanceof InvalidTripProofError);
        return true;
      }
    );
  });
});
