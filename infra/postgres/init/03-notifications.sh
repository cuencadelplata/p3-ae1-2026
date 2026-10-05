#!/bin/sh
# Prepara el rol y el esquema propios de RF8.1 Notifications (RNF-04).
#
# PostgreSQL ejecuta este script automaticamente solo al inicializar un volumen
# vacio. Si el volumen m8-postgres ya existe, puede ejecutarse manualmente con:
#
# docker compose exec postgres sh /docker-entrypoint-initdb.d/03-notifications.sh
#
# Las tablas funcionales las crea RF8.1 mediante runMigrations(pool).
set -eu

psql -v ON_ERROR_STOP=1 \
  -v db="$POSTGRES_DB" \
  -v pwd="$NOTIFICATIONS_DB_PASSWORD" \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" <<'EOSQL'
REVOKE ALL ON DATABASE :"db" FROM PUBLIC;
REVOKE ALL ON SCHEMA public FROM PUBLIC;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'm8_notifications') THEN
    CREATE ROLE m8_notifications LOGIN;
  END IF;
END
$$;

ALTER ROLE m8_notifications WITH PASSWORD :'pwd';
ALTER ROLE m8_notifications SET search_path = notifications;
GRANT CONNECT ON DATABASE :"db" TO m8_notifications;

CREATE SCHEMA IF NOT EXISTS notifications AUTHORIZATION m8_notifications;
ALTER SCHEMA notifications OWNER TO m8_notifications;
GRANT USAGE, CREATE ON SCHEMA notifications TO m8_notifications;

DO $$
DECLARE
  item record;
BEGIN
  FOR item IN
    SELECT schemaname, tablename
    FROM pg_tables
    WHERE schemaname = 'notifications'
  LOOP
    EXECUTE format('ALTER TABLE %I.%I OWNER TO m8_notifications', item.schemaname, item.tablename);
  END LOOP;

  FOR item IN
    SELECT sequence_schema, sequence_name
    FROM information_schema.sequences
    WHERE sequence_schema = 'notifications'
  LOOP
    EXECUTE format('ALTER SEQUENCE %I.%I OWNER TO m8_notifications', item.sequence_schema, item.sequence_name);
  END LOOP;
END
$$;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA notifications TO m8_notifications;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA notifications TO m8_notifications;
ALTER DEFAULT PRIVILEGES FOR ROLE m8_notifications IN SCHEMA notifications
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO m8_notifications;
ALTER DEFAULT PRIVILEGES FOR ROLE m8_notifications IN SCHEMA notifications
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO m8_notifications;
EOSQL
