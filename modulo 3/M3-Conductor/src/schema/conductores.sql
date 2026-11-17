-- Tabla de conductores (Módulo 3)
-- Fuente de verdad persistente. El estado de habilitación (RF 3.1) vive acá;
-- Redis sólo lo cachea con TTL (ver src/repositories/redisRepository.js).
-- La disponibilidad (RF 3.3) vive en Redis como heartbeat con TTL; la columna
-- `disponible` es el respaldo en BD (se escribe solo cuando el valor cambia) y
-- se usa cuando Redis no tiene la clave o está caído.

CREATE TABLE IF NOT EXISTS conductores (
  usuario_id      TEXT PRIMARY KEY,          -- viene de la API de M1 (usuarios)
  ciudad          TEXT NOT NULL,
  tipo_vehiculo   TEXT NOT NULL,
  licencia_id     TEXT,                      -- viene de la API de licencias
  vehiculo_id     TEXT,                      -- viene de la API de vehículos
  habilitado      TEXT NOT NULL DEFAULT 'pendiente'
                    CHECK (habilitado IN ('pendiente', 'activo', 'suspendido', 'rechazado')),
  disponible      BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_conductores_habilitado ON conductores (habilitado);
