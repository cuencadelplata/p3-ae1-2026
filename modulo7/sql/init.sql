-- Tabla de reintegros (RF-7.6)
CREATE TABLE IF NOT EXISTS reintegros (
  id                SERIAL PRIMARY KEY,
  id_orden          TEXT NOT NULL UNIQUE,
  viaje_id          TEXT NOT NULL,
  monto_cancelacion NUMERIC(12,2) NOT NULL,
  monto_reintegro   NUMERIC(12,2) NOT NULL,
  creado_en         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
