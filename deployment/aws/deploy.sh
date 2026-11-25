#!/usr/bin/env bash
set -euo pipefail
DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd -- "$DIR/../.." && pwd)"
ENV_FILE="$DIR/.env"
[[ -f "$ENV_FILE" ]] || { echo 'Primero ejecutar prepare.mjs y completar deployment/aws/.env.' >&2; exit 1; }
chmod 600 "$ENV_FILE"
# El entorno se lee con Docker; nunca se ejecuta como código shell.
COMPOSE=(docker compose --env-file "$ENV_FILE" -f "$ROOT/docker-compose.yml" -f "$DIR/compose.aws.yml")
check_configuration() {
  "${COMPOSE[@]}" config --quiet
  "${COMPOSE[@]}" config --format json | python3 "$DIR/validate.py"
}
case "${1:-check}" in
  check) check_configuration; echo 'Configuración AWS válida. No se iniciaron contenedores.' ;;
  up)
    check_configuration
    docker network inspect reservas-network >/dev/null 2>&1 || docker network create reservas-network
    # Una llamada por servicio evita la construcción simultánea de todo el stack.
    while IFS= read -r service; do
      [[ -n "$service" ]] && "${COMPOSE[@]}" build "$service"
    done < <("${COMPOSE[@]}" config --format json | python3 -c 'import json,sys; s=json.load(sys.stdin)["services"]; seen=set(); [(print(k),seen.add(v.get("image",k))) for k,v in s.items() if v.get("build") and v.get("image",k) not in seen]')
    "${COMPOSE[@]}" up -d --no-build --wait --wait-timeout 300
    "${COMPOSE[@]}" ps
    ;;
  status) "${COMPOSE[@]}" ps ;;
  down) "${COMPOSE[@]}" down ;;
  *) echo 'Uso: bash deployment/aws/deploy.sh [check|up|status|down]' >&2; exit 1 ;;
esac
