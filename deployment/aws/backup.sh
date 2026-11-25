#!/usr/bin/env bash
set -euo pipefail
umask 077
DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
TARGET="${1:?Indicar un directorio nuevo para el backup}"
mkdir "$TARGET"
DC=(bash "$DIR/dc.sh")
for service in postgres m2-db m4-postgres m5-postgres-db m6-tripdb m7-db m8-postgres; do
  "${DC[@]}" exec -T "$service" sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$TARGET/$service.dump"
  test -s "$TARGET/$service.dump"
  "${DC[@]}" exec -T "$service" pg_restore --list < "$TARGET/$service.dump" > "$TARGET/$service.list"
done
# SQLite online backup incluye los cambios del WAL sin detener M1.
"${DC[@]}" exec -T m1-identidad-acceso node -e 'const D=require("better-sqlite3");new D("/app/data/identity.db").backup("/tmp/identity-backup.db").then(()=>{}).catch(()=>process.exit(1))'
"${DC[@]}" cp m1-identidad-acceso:/tmp/identity-backup.db "$TARGET/identity.db"
test -s "$TARGET/identity.db"
python3 - "$TARGET/identity.db" <<'PY'
import sqlite3,sys
assert sqlite3.connect(sys.argv[1]).execute('PRAGMA integrity_check').fetchone()[0]=='ok'
PY
(cd "$TARGET" && sha256sum *.dump identity.db > SHA256SUMS)
echo 'Backup exportado; SQLite integro y archivos PostgreSQL legibles. Falta ensayo de restauracion aislada.'
