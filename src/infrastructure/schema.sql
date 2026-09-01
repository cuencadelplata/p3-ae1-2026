PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;

CREATE TABLE IF NOT EXISTS direcciones (
  id TEXT PRIMARY KEY,
  clienteId TEXT NOT NULL,
  alias TEXT,
  direccion TEXT,
  latitud REAL,
  longitud REAL,
  tipo TEXT NOT NULL CHECK (tipo IN ('FAVORITA', 'RECIENTE')),
  uso TEXT NOT NULL CHECK (uso IN ('ORIGEN', 'DESTINO', 'AMBOS')),
  fechaCreacion TEXT NOT NULL,
  fechaActualizacion TEXT NOT NULL,

  CHECK (
    (latitud IS NULL AND longitud IS NULL)
    OR (
      latitud IS NOT NULL AND longitud IS NOT NULL
      AND latitud BETWEEN -90 AND 90
      AND longitud BETWEEN -180 AND 180
    )
  ),

  CHECK (
    (direccion IS NOT NULL AND length(trim(direccion)) > 0)
    OR latitud IS NOT NULL
  )
) STRICT;

CREATE INDEX IF NOT EXISTS idx_direcciones_cliente
ON direcciones(clienteId, fechaCreacion DESC, id DESC);