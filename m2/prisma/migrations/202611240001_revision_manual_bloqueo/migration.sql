-- Revisión manual de bloqueos (contrato con M8 / Soporte).
-- La tabla customers.AccountStatus la crea docker/init-db; esta migración agrega la columna
-- en bases que ya existían. IF EXISTS / IF NOT EXISTS: no falla si la tabla no está o si
-- la base es nueva y la columna ya vino en el init.
ALTER TABLE IF EXISTS customers.AccountStatus
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMP WITH TIME ZONE;
