-- Tabla de conductores (Módulo 3)
-- Fuente de verdad persistente. El estado de habilitación (RF 3.1) vive acá;
-- Redis sólo lo cachea con TTL (ver src/repositories/redisRepository.js).
-- El estado de disponibilidad (RF 3.3) es efímero y NO se persiste en esta tabla:
-- vive únicamente en Redis mientras el conductor está conectado.

CREATE TABLE IF NOT EXISTS conductores (
  usuario_id      TEXT PRIMARY KEY,          -- viene de la API de M1 (usuarios)
  ciudad          TEXT NOT NULL,
  tipo_vehiculo   TEXT NOT NULL,
  licencia_id     TEXT,                      -- viene de la API de licencias
  vehiculo_id     TEXT,                      -- viene de la API de vehículos
  habilitado      TEXT NOT NULL DEFAULT 'pendiente'
                    CHECK (habilitado IN ('pendiente', 'activo', 'suspendido', 'rechazado')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_conductores_habilitado ON conductores (habilitado);
