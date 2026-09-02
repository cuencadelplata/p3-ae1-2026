import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { CustomerRatingController, HttpRequest } from "../../interfaces/http/controllers/CustomerRatingController.js";
import { CreateCustomerRatingUseCase } from "../../application/use-cases/CreateCustomerRatingUseCase.js";
import { InMemoryCustomerRatingRepository } from "../../infrastructure/persistence/InMemoryCustomerRatingRepository.js";
import { InMemoryCustomerRepository } from "../../infrastructure/persistence/InMemoryCustomerRepository.js";
import { InMemoryEventPublisher } from "../../infrastructure/messaging/InMemoryEventPublisher.js";
import { HmacTripVerificationService } from "../../infrastructure/security/HmacTripVerificationService.js";
import { Customer } from "../../domain/entities/Customer.js";
import { CustomerId } from "../../domain/value-objects/Identifiers.js";
import { ProblemDetails } from "../../interfaces/http/dtos/HttpProblemDetails.js";
import { RatingOutputDTO } from "../../application/dtos/RatingDTOs.js";

describe("CustomerRatingController - HTTP Interface Layer", () => {
  let controller: CustomerRatingController;
  let ratingRepo: InMemoryCustomerRatingRepository;
  let customerRepo: InMemoryCustomerRepository;
  let tripVerifier: HmacTripVerificationService;

  const validCustomerId = "11111111-1111-4111-8111-111111111111";
  const validTripId = "22222222-2222-4222-8222-222222222222";
  const validDriverId = "33333333-3333-4333-8333-333333333333";

  beforeEach(() => {
    ratingRepo = new InMemoryCustomerRatingRepository();
    customerRepo = new InMemoryCustomerRepository();
    const eventPublisher = new InMemoryEventPublisher();
    tripVerifier = new HmacTripVerificationService("test-secret-key");

    const useCase = new CreateCustomerRatingUseCase({
      customerRatingRepository: ratingRepo,
      customerRepository: customerRepo,
      tripVerificationService: tripVerifier,
      eventPublisher: eventPublisher,
    });

    controller = new CustomerRatingController(useCase);

    // Cliente registrado y activo en CustomerDB
    customerRepo.save(
      new Customer({
        id: CustomerId.fromString(validCustomerId),
        firstName: "Lucía",
        lastName: "Fernández",
        email: "lucia.fernandez@example.com",
        phoneNumber: "+5491199998888",
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
    );
  });

  it("debe responder con HTTP 201 Created y encabezado Location al registrar una calificación válida", async () => {
    const request: HttpRequest = {
      params: { customerId: validCustomerId },
      body: {
        tripId: validTripId,
        driverId: validDriverId,
        score: 5,
        comment: "Excelente viaje.",
      },
      path: `/api/v1/customers/${validCustomerId}/ratings`,
    };

    const response = await controller.handleCreateRating(request);

    assert.equal(response.status, 201);
    const body = response.body as RatingOutputDTO;
    assert.ok(body.id);
    assert.equal(body.customerId, validCustomerId);
    assert.equal(body.tripId, validTripId);
    assert.equal(body.score, 5);
    assert.equal(response.headers?.Location, `/api/v1/customers/${validCustomerId}/ratings/${body.id}`);
  });

  it("debe responder con HTTP 400 Bad Request cuando el puntaje es menor a 1 o mayor a 5", async () => {
    const reqUnder: HttpRequest = {
      params: { customerId: validCustomerId },
      body: {
        tripId: validTripId,
        driverId: validDriverId,
        score: 0,
      },
      path: `/api/v1/customers/${validCustomerId}/ratings`,
    };

    const resUnder = await controller.handleCreateRating(reqUnder);
    assert.equal(resUnder.status, 400);
    const bodyUnder = resUnder.body as ProblemDetails;
    assert.equal(bodyUnder.status, 400);
    assert.ok(bodyUnder.invalidParams?.some((p) => p.name === "score"));

    const reqOver: HttpRequest = {
      params: { customerId: validCustomerId },
      body: {
        tripId: validTripId,
        driverId: validDriverId,
        score: 6,
      },
      path: `/api/v1/customers/${validCustomerId}/ratings`,
    };

    const resOver = await controller.handleCreateRating(reqOver);
    assert.equal(resOver.status, 400);
  });

  it("debe responder con HTTP 400 Bad Request cuando faltan campos obligatorios en el body", async () => {
    const request: HttpRequest = {
      params: { customerId: validCustomerId },
      body: {
        // Falta tripId, driverId, score
      },
      path: `/api/v1/customers/${validCustomerId}/ratings`,
    };

    const response = await controller.handleCreateRating(request);
    assert.equal(response.status, 400);
    const body = response.body as ProblemDetails;
    assert.equal(body.code, "VALIDATION_ERROR");
    assert.equal(body.invalidParams?.length, 3);
  });

  it("debe responder con HTTP 404 Not Found si el cliente no existe en CustomerDB", async () => {
    const nonExistentId = "00000000-0000-4000-8000-000000000000";
    const request: HttpRequest = {
      params: { customerId: nonExistentId },
      body: {
        tripId: validTripId,
        driverId: validDriverId,
        score: 5,
      },
      path: `/api/v1/customers/${nonExistentId}/ratings`,
    };

    const response = await controller.handleCreateRating(request);
    assert.equal(response.status, 404);
    const body = response.body as ProblemDetails;
    assert.equal(body.code, "CUSTOMER_NOT_FOUND");
  });

  it("debe responder con HTTP 409 Conflict si ya existe una calificación previa para el viaje", async () => {
    const request: HttpRequest = {
      params: { customerId: validCustomerId },
      body: {
        tripId: validTripId,
        driverId: validDriverId,
        score: 4,
      },
      path: `/api/v1/customers/${validCustomerId}/ratings`,
    };

    // Primera invocación exitosa
    const res1 = await controller.handleCreateRating(request);
    assert.equal(res1.status, 201);

    // Segunda invocación para el mismo viaje
    const res2 = await controller.handleCreateRating(request);
    assert.equal(res2.status, 409);
    const body2 = res2.body as ProblemDetails;
    assert.equal(body2.code, "DUPLICATE_TRIP_RATING");
    assert.equal(body2.title, "Conflict - Calificación Duplicada");
  });

  it("debe responder con HTTP 422 Unprocessable Entity si el token de viaje es inválido", async () => {
    const request: HttpRequest = {
      params: { customerId: validCustomerId },
      body: {
        tripId: validTripId,
        driverId: validDriverId,
        score: 5,
        tripCompletionProof: "invalid.token.here",
      },
      path: `/api/v1/customers/${validCustomerId}/ratings`,
    };

    const response = await controller.handleCreateRating(request);
    assert.equal(response.status, 422);
    const body = response.body as ProblemDetails;
    assert.equal(body.code, "INVALID_TRIP_PROOF");
  });
});
