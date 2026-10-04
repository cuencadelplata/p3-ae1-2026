#!/bin/sh
# Inicializa el esquema "messaging", la tabla de Inbox técnico y la tabla de Outbox (RF8.6).
#
# La restricción UNIQUE(consumer_id, message_id) / PRIMARY KEY en inbox_events garantiza
# la deduplicación idempotente a nivel base de datos para consumo asíncrono.
set -eu

psql -v ON_ERROR_STOP=1 \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" <<'EOSQL'
CREATE SCHEMA IF NOT EXISTS messaging;

CREATE TABLE IF NOT EXISTS messaging.inbox_events (
  consumer_id VARCHAR(255) NOT NULL,
  message_id VARCHAR(255) NOT NULL,
  event_type VARCHAR(255) NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'PENDING',
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (consumer_id, message_id)
);

CREATE TABLE IF NOT EXISTS messaging.outbox_events (
  id VARCHAR(255) PRIMARY KEY,
  event_type VARCHAR(255) NOT NULL,
  routing_key VARCHAR(255),
  correlation_id VARCHAR(255),
  payload JSONB NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'PENDING',
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  published_at TIMESTAMPTZ
);

REVOKE ALL ON SCHEMA messaging FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA messaging FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'm8_receipts') THEN
    GRANT USAGE ON SCHEMA messaging TO m8_receipts;
    GRANT ALL ON ALL TABLES IN SCHEMA messaging TO m8_receipts;
  END IF;
END $$;
EOSQL
