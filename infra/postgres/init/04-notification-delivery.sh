#!/bin/sh
# Prepara el rol y el esquema propios de RF8.7 Entrega de Notificaciones (RNF-04).
#
# El rol m8_notification_delivery es dueno exclusivo del esquema "notification_delivery"
# y recibe unicamente los permisos necesarios sobre la tabla compartida de Inbox
# de mensajeria "messaging.inbox_events" (RF8.6), sin acceso a receipts ni a otros esquemas.
set -eu

psql -v ON_ERROR_STOP=1 \
  -v db="$POSTGRES_DB" \
  -v pwd="${DELIVERY_DB_PASSWORD:-m8_delivery_local}" \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" <<'EOSQL'

-- 1. Crear rol propio para el servicio de entrega de notificaciones
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'm8_notification_delivery') THEN
    CREATE ROLE m8_notification_delivery LOGIN;
  END IF;
END
$$;

ALTER ROLE m8_notification_delivery WITH PASSWORD :'pwd';
ALTER ROLE m8_notification_delivery SET search_path = notification_delivery, messaging;
GRANT CONNECT ON DATABASE :"db" TO m8_notification_delivery;

-- 2. Crear esquema propio notification_delivery
CREATE SCHEMA IF NOT EXISTS notification_delivery AUTHORIZATION m8_notification_delivery;
ALTER SCHEMA notification_delivery OWNER TO m8_notification_delivery;
GRANT USAGE, CREATE ON SCHEMA notification_delivery TO m8_notification_delivery;

-- 3. Permisos sobre el esquema messaging de RF8.6 si ya existe
DO $$
BEGIN
  IF EXISTS (SELECT FROM information_schema.schemata WHERE schema_name = 'messaging') THEN
    GRANT USAGE ON SCHEMA messaging TO m8_notification_delivery;
    GRANT ALL ON ALL TABLES IN SCHEMA messaging TO m8_notification_delivery;
  END IF;
END $$;

-- 4. Tablas funcionales de notification_delivery con userId BIGINT (canónico numérico de M1)
CREATE TABLE IF NOT EXISTS notification_delivery.device_tokens (
    token_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id BIGINT NOT NULL,
    token VARCHAR(255) NOT NULL UNIQUE,
    platform VARCHAR(32) NOT NULL DEFAULT 'ANDROID', -- ANDROID, IOS, WEB
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_device_tokens_user_active
    ON notification_delivery.device_tokens (user_id, is_active);

CREATE TABLE IF NOT EXISTS notification_delivery.delivery_requests (
    delivery_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    notification_id VARCHAR(64) NOT NULL,
    message_id VARCHAR(64) NOT NULL UNIQUE,
    trip_id VARCHAR(64) NOT NULL,
    user_id BIGINT NOT NULL,
    event_type VARCHAR(64) NOT NULL,
    channel VARCHAR(32) NOT NULL DEFAULT 'PUSH',
    status VARCHAR(32) NOT NULL DEFAULT 'PENDING',
    title VARCHAR(255),
    message TEXT NOT NULL,
    device_token VARCHAR(255),
    skip_reason VARCHAR(64),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_delivery_requests_notification
    ON notification_delivery.delivery_requests (notification_id);

CREATE TABLE IF NOT EXISTS notification_delivery.delivery_attempts (
    attempt_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    delivery_id UUID NOT NULL REFERENCES notification_delivery.delivery_requests(delivery_id) ON DELETE CASCADE,
    attempt_number INTEGER NOT NULL,
    status VARCHAR(32) NOT NULL, -- SUCCESS, FAILED
    provider_response TEXT,
    error_message TEXT,
    latency_ms INTEGER NOT NULL,
    attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Transferir ownership explícito de tablas al rol propio y revocar acceso público (RNF-04)
DO $$
DECLARE
  item record;
BEGIN
  FOR item IN
    SELECT schemaname, tablename
    FROM pg_tables
    WHERE schemaname = 'notification_delivery'
  LOOP
    EXECUTE format('ALTER TABLE %I.%I OWNER TO m8_notification_delivery', item.schemaname, item.tablename);
  END LOOP;
END
$$;

REVOKE ALL ON SCHEMA notification_delivery FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA notification_delivery FROM PUBLIC;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA notification_delivery TO m8_notification_delivery;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA notification_delivery TO m8_notification_delivery;
ALTER DEFAULT PRIVILEGES FOR ROLE m8_notification_delivery IN SCHEMA notification_delivery
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO m8_notification_delivery;

EOSQL
