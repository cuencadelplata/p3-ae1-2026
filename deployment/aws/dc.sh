#!/usr/bin/env bash
set -euo pipefail
DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
exec docker compose --env-file "$DIR/.env" -f "$DIR/../../docker-compose.yml" -f "$DIR/compose.aws.yml" "$@"
