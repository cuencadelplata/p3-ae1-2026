#!/bin/sh
# Crea el esquema y el rol propios del servicio de comprobantes (RNF-04).
#
# El rol m8_receipts es dueño exclusivo del esquema "receipts" y no recibe
# permisos sobre ningún otro. Cualquier otro rol que intente leer sus tablas
# recibe un error de permisos, lo que convierte la propiedad de los datos en una
# restricción verificable y no solo en un acuerdo.
#
# PostgreSQL ejecuta este script únicamente al inicializar un volumen vacío.
set -eu

psql -v ON_ERROR_STOP=1 \
  -v db="$POSTGRES_DB" \
  -v pwd="$RECEIPTS_DB_PASSWORD" \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" <<'EOSQL'
REVOKE ALL ON DATABASE :"db" FROM PUBLIC;
REVOKE ALL ON SCHEMA public FROM PUBLIC;

CREATE ROLE m8_receipts LOGIN PASSWORD :'pwd';
GRANT CONNECT ON DATABASE :"db" TO m8_receipts;

CREATE SCHEMA receipts AUTHORIZATION m8_receipts;
ALTER ROLE m8_receipts SET search_path = receipts;
EOSQL
