-- Preserve UUID demo identities and support numeric identifiers issued by M1.
ALTER TABLE "reservations" ALTER COLUMN "client_id" TYPE VARCHAR(128) USING "client_id"::text;
