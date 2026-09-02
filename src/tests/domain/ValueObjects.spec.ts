import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Score } from "../../domain/value-objects/Score.js";
import { Comment } from "../../domain/value-objects/Comment.js";
import { CustomerId, TripId, DriverId, RatingId } from "../../domain/value-objects/Identifiers.js";
import { InvalidRatingScoreError, InvalidCommentError, InvalidUuidError } from "../../domain/errors/DomainErrors.js";

describe("Value Objects - Domain Layer", () => {
  describe("Score", () => {
    it("debe permitir valores válidos entre 1 y 5", () => {
      for (const val of [1, 2, 3, 4, 5]) {
        const score = Score.create(val);
        assert.equal(score.value, val);
      }
    });

    it("debe rechazar puntuaciones menores a 1", () => {
      assert.throws(() => Score.create(0), InvalidRatingScoreError);
      assert.throws(() => Score.create(-1), InvalidRatingScoreError);
      assert.throws(() => Score.create(-5), InvalidRatingScoreError);
    });

    it("debe rechazar puntuaciones mayores a 5", () => {
      assert.throws(() => Score.create(6), InvalidRatingScoreError);
      assert.throws(() => Score.create(10), InvalidRatingScoreError);
      assert.throws(() => Score.create(100), InvalidRatingScoreError);
    });

    it("debe rechazar números decimales o no enteros", () => {
      assert.throws(() => Score.create(4.5), InvalidRatingScoreError);
      assert.throws(() => Score.create(1.1), InvalidRatingScoreError);
      assert.throws(() => Score.create(NaN), InvalidRatingScoreError);
      // @ts-expect-error testing invalid runtime types
      assert.throws(() => Score.create("5"), InvalidRatingScoreError);
    });
  });

  describe("Comment", () => {
    it("debe aceptar comentarios válidos y aplicar trim", () => {
      const comment = Comment.create("  Excelente viaje y conductor muy amable  ");
      assert.equal(comment.value, "Excelente viaje y conductor muy amable");
      assert.equal(comment.hasValue(), true);
    });

    it("debe manejar comentarios nulos, vacíos o undefined", () => {
      assert.equal(Comment.create(null).value, undefined);
      assert.equal(Comment.create(undefined).value, undefined);
      assert.equal(Comment.create("   ").value, undefined);
      assert.equal(Comment.create("").value, undefined);
    });

    it("debe aceptar comentarios de exactamente 500 caracteres", () => {
      const exact500 = "a".repeat(500);
      const comment = Comment.create(exact500);
      assert.equal(comment.value?.length, 500);
    });

    it("debe rechazar comentarios que excedan los 500 caracteres", () => {
      const over500 = "a".repeat(501);
      assert.throws(() => Comment.create(over500), InvalidCommentError);
    });
  });

  describe("Identifiers (UUIDs)", () => {
    const validUuid = "123e4567-e89b-12d3-a456-426614174000";
    const invalidUuid = "not-a-valid-uuid-123";

    it("debe crear instancias válidas con UUID v4", () => {
      const customerId = CustomerId.fromString(validUuid);
      const tripId = TripId.fromString(validUuid);
      const driverId = DriverId.fromString(validUuid);
      const ratingId = RatingId.fromString(validUuid);

      assert.equal(customerId.value, validUuid.toLowerCase());
      assert.equal(tripId.value, validUuid.toLowerCase());
      assert.equal(driverId.value, validUuid.toLowerCase());
      assert.equal(ratingId.value, validUuid.toLowerCase());
    });

    it("debe rechazar cadenas que no sean UUIDs válidos", () => {
      assert.throws(() => CustomerId.fromString(invalidUuid), InvalidUuidError);
      assert.throws(() => TripId.fromString(invalidUuid), InvalidUuidError);
      assert.throws(() => DriverId.fromString(invalidUuid), InvalidUuidError);
      assert.throws(() => RatingId.fromString(invalidUuid), InvalidUuidError);
      assert.throws(() => CustomerId.fromString(""), InvalidUuidError);
    });

    it("debe generar automáticamente UUIDs válidos con create()", () => {
      const autoId = RatingId.create();
      assert.ok(autoId.value.length > 0);
      assert.doesNotThrow(() => RatingId.fromString(autoId.value));
    });
  });
});
