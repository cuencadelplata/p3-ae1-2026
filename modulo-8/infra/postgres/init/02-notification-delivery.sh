#!/bin/sh
# Crea el esquema y el rol propios del servicio de entrega de notificaciones (RF-8.7 / RNF-04).
#
# El rol m8_delivery es dueño exclusivo del esquema "delivery" y no recibe
# permisos sobre las tablas de "receipts" ni ningún otro servicio.
# Esto garantiza aislamiento estricto y propiedad de datos verificable.
set -eu

psql -v ON_ERROR_STOP=1 \
  -v db="$POSTGRES_DB" \
  -v pwd="${DELIVERY_DB_PASSWORD:-m8_delivery_local}" \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" <<'EOSQL'
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'm8_delivery') THEN
    CREATE ROLE m8_delivery LOGIN PASSWORD :'pwd';
  END IF;
END
$$;

GRANT CONNECT ON DATABASE :"db" TO m8_delivery;

CREATE SCHEMA IF NOT EXISTS delivery AUTHORIZATION m8_delivery;
ALTER ROLE m8_delivery SET search_path = delivery;

GRANT ALL PRIVILEGES ON SCHEMA delivery TO m8_delivery;
EOSQL
