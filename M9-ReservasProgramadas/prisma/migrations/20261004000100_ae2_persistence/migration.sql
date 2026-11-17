CREATE TYPE "ReservationStatus" AS ENUM ('PROGRAMADA', 'ACTIVANDO', 'ACTIVADA', 'CANCELADA', 'FALLIDA');
CREATE TYPE "VehicleType" AS ENUM ('AUTO', 'MOTO');
CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'PUBLISHED', 'FAILED');

CREATE TABLE "reservations" (
  "id" UUID NOT NULL,
  "client_id" UUID NOT NULL,
  "origin" TEXT NOT NULL,
  "destination" TEXT NOT NULL,
  "vehicle_type" "VehicleType" NOT NULL,
  "scheduled_at" TIMESTAMPTZ(3) NOT NULL,
  "status" "ReservationStatus" NOT NULL DEFAULT 'PROGRAMADA',
  "estimated_fare" DECIMAL(12,2),
  "currency" VARCHAR(3),
  "fare_estimate_id" TEXT,
  "route_snapshot" JSONB,
  "assignment_criteria" TEXT,
  "dispatch_request_id" UUID,
  "assigned_driver_id" UUID,
  "dispatch_idempotency_key" UUID,
  "version" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "reservations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "reservations_distinct_route_chk" CHECK (lower(trim("origin")) <> lower(trim("destination")))
);

CREATE TABLE "outbox_events" (
  "id" UUID NOT NULL,
  "event_id" UUID NOT NULL,
  "aggregate_id" UUID NOT NULL,
  "event_type" TEXT NOT NULL,
  "event_version" INTEGER NOT NULL,
  "routing_key" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "correlation_id" TEXT NOT NULL,
  "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "last_error" TEXT,
  "next_attempt_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "published_at" TIMESTAMPTZ(3),
  CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "outbox_attempts_nonnegative_chk" CHECK ("attempts" >= 0),
  CONSTRAINT "outbox_event_version_positive_chk" CHECK ("event_version" > 0)
);

CREATE TABLE "inbox_events" (
  "event_id" UUID NOT NULL,
  "event_type" TEXT NOT NULL,
  "aggregate_id" UUID NOT NULL,
  "correlation_id" TEXT NOT NULL,
  "processed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "inbox_events_pkey" PRIMARY KEY ("event_id")
);

CREATE UNIQUE INDEX "reservations_dispatch_request_id_key" ON "reservations"("dispatch_request_id");
CREATE UNIQUE INDEX "reservations_dispatch_idempotency_key_key" ON "reservations"("dispatch_idempotency_key");
CREATE INDEX "reservations_status_scheduled_at_idx" ON "reservations"("status", "scheduled_at");
CREATE INDEX "reservations_client_id_idx" ON "reservations"("client_id");
CREATE UNIQUE INDEX "outbox_events_event_id_key" ON "outbox_events"("event_id");
CREATE INDEX "outbox_status_next_attempt_idx" ON "outbox_events"("status", "next_attempt_at", "created_at");
CREATE INDEX "outbox_aggregate_created_idx" ON "outbox_events"("aggregate_id", "created_at");
CREATE INDEX "inbox_aggregate_processed_idx" ON "inbox_events"("aggregate_id", "processed_at");
