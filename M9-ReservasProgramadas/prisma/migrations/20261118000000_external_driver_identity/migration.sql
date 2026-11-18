-- M4/M5 identifican conductores también con IDs numéricos serializados como texto.
-- Conservar el identificador canónico; no inventar un UUID al integrar módulos.
ALTER TABLE "reservations"
ALTER COLUMN "assigned_driver_id" TYPE TEXT USING "assigned_driver_id"::text;
