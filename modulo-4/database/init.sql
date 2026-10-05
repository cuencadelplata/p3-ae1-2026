CREATE TABLE IF NOT EXISTS driver_location_history (
  id BIGSERIAL PRIMARY KEY,
  driver_id INTEGER NOT NULL,
  latitude DOUBLE PRECISION NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude DOUBLE PRECISION NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  vehicle_type VARCHAR(10) NOT NULL CHECK (vehicle_type IN ('AUTO', 'MOTO')),
  available BOOLEAN NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_driver_location_history_driver_recorded
  ON driver_location_history (driver_id, recorded_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_driver_location_history_idempotency
  ON driver_location_history (driver_id, recorded_at);
