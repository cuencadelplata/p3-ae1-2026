#!/bin/sh
# Crea el esquema y el rol propios del servicio de soporte (RF-8.5).
#
# El rol m8_support es dueño exclusivo del esquema "support" y no recibe
# permisos sobre ningún otro. Aquí sólo hay infraestructura: las tablas, los
# índices y las restricciones los crean las migraciones de Support al arrancar.
#
# PostgreSQL ejecuta este script únicamente al inicializar un volumen vacío.
# Es idempotente, así que en un volumen que ya existía se aplica a mano:
#
#   docker compose exec postgres sh /docker-entrypoint-initdb.d/02-support.sh
#
# Si el rol ya existe se le vuelve a asignar la contraseña configurada: volver
# a ejecutarlo es también la forma de aplicar un cambio de SUPPORT_DB_PASSWORD.
set -eu

: "${SUPPORT_DB_PASSWORD:?Falta SUPPORT_DB_PASSWORD en el contenedor de PostgreSQL}"

psql -v ON_ERROR_STOP=1 \
  -v db="$POSTGRES_DB" \
  -v pwd="$SUPPORT_DB_PASSWORD" \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" <<'EOSQL'
SELECT 'CREATE ROLE m8_support LOGIN'
 WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'm8_support') \gexec
ALTER ROLE m8_support LOGIN PASSWORD :'pwd';
GRANT CONNECT ON DATABASE :"db" TO m8_support;

CREATE SCHEMA IF NOT EXISTS support AUTHORIZATION m8_support;
ALTER ROLE m8_support SET search_path = support;
EOSQL
