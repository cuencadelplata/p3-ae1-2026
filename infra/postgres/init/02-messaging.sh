#!/bin/sh
# Inicializa el esquema "messaging" y la tabla de Inbox técnico (RF8.6).
#
# La restricción UNIQUE(consumer_id, message_id) / PRIMARY KEY garantiza
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

GRANT ALL ON SCHEMA messaging TO PUBLIC;
GRANT ALL ON ALL TABLES IN SCHEMA messaging TO PUBLIC;
EOSQL
