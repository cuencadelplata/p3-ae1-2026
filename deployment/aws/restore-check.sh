#!/usr/bin/env bash
set -euo pipefail
SOURCE="${1:?Directorio de backup requerido}"
NAME="movilidad-restore-check-$(date +%s)"
umask 077
PASS="$(openssl rand -hex 24)"
docker run -d --name "$NAME" --network none -e POSTGRES_PASSWORD="$PASS" postgres:17-alpine >/dev/null
trap 'docker rm -f "$NAME" >/dev/null' EXIT
for attempt in $(seq 1 30); do
  docker exec "$NAME" pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1 && break
  sleep 1
done
for file in "$SOURCE"/*.dump; do
  database="check_$(basename "$file" .dump | tr - _ )"
  docker exec "$NAME" createdb -U postgres "$database"
  docker exec -i "$NAME" pg_restore -U postgres --no-owner --no-privileges --exit-on-error -d "$database" < "$file"
  tables="$(docker exec "$NAME" psql -U postgres -d "$database" -Atc "select count(*) from pg_tables where schemaname not in ('pg_catalog','information_schema')")"
  echo "$(basename "$file"): restaurado; tablas=$tables"
done
python3 - "$SOURCE/identity.db" <<'PY'
import sqlite3,sys,tempfile,pathlib
with tempfile.TemporaryDirectory() as directory:
    source=sqlite3.connect('file:'+sys.argv[1]+'?mode=ro',uri=True)
    target=sqlite3.connect(str(pathlib.Path(directory)/'restored.db'))
    source.backup(target)
    assert target.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
    print('SQLite M1: restauracion e integridad OK')
    target.close(); source.close()
PY
