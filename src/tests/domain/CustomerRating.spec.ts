import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CustomerRating } from "../../domain/entities/CustomerRating.js";
import { CustomerId, TripId, DriverId, RatingId } from "../../domain/value-objects/Identifiers.js";
import { Score } from "../../domain/value-objects/Score.js";
import { Comment } from "../../domain/value-objects/Comment.js";
import { DriverRatingSubmittedEvent } from "../../domain/events/DriverRatingSubmittedEvent.js";

describe("CustomerRating Entity - Domain Layer", () => {
  const customerIdStr = "11111111-1111-4111-8111-111111111111";
  const tripIdStr = "22222222-2222-4222-8222-222222222222";
  const driverIdStr = "33333333-3333-4333-8333-333333333333";

  it("debe crear una calificación válida y generar el evento de dominio DriverRatingSubmittedEvent", () => {
    const customerId = CustomerId.fromString(customerIdStr);
    const tripId = TripId.fromString(tripIdStr);
    const driverId = DriverId.fromString(driverIdStr);
    const score = Score.create(5);
    const comment = Comment.create("Conductor muy educado y puntual.");

    const rating = CustomerRating.create({
      customerId,
      tripId,
      driverId,
      score,
      comment,
    });

    assert.ok(rating.id);
    assert.equal(rating.customerId.value, customerIdStr);
    assert.equal(rating.tripId.value, tripIdStr);
    assert.equal(rating.driverId.value, driverIdStr);
    assert.equal(rating.score.value, 5);
    assert.equal(rating.comment.value, "Conductor muy educado y puntual.");
    assert.ok(rating.createdAt instanceof Date);
    assert.ok(rating.updatedAt instanceof Date);

    // Verificar generación de evento de dominio
    const events = rating.pullDomainEvents();
    assert.equal(events.length, 1);
    const event = events[0];
    assert.equal(event.eventName, DriverRatingSubmittedEvent.EVENT_NAME);
    assert.equal(event.payload.ratingId, rating.id.value);
    assert.equal(event.payload.customerId, customerIdStr);
    assert.equal(event.payload.tripId, tripIdStr);
    assert.equal(event.payload.driverId, driverIdStr);
    assert.equal(event.payload.score, 5);
    assert.equal(event.payload.comment, "Conductor muy educado y puntual.");

    // Al volver a llamar pullDomainEvents, la cola debe estar vacía
    assert.equal(rating.pullDomainEvents().length, 0);
  });

  it("debe reconstituir una entidad desde almacenamiento sin emitir nuevos eventos de creación", () => {
    const persistedRating = CustomerRating.reconstitute({
      id: "44444444-4444-4444-8444-444444444444",
      customerId: customerIdStr,
      tripId: tripIdStr,
      driverId: driverIdStr,
      score: 4,
      comment: "Buen viaje",
      createdAt: new Date("2026-08-01T10:00:00Z"),
      updatedAt: new Date("2026-08-01T10:00:00Z"),
    });

    assert.equal(persistedRating.id.value, "44444444-4444-4444-8444-444444444444");
    assert.equal(persistedRating.score.value, 4);
    assert.equal(persistedRating.pullDomainEvents().length, 0);
  });
});
