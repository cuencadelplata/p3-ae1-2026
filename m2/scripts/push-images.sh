#!/usr/bin/env bash
#
# Reconstruye y publica las imágenes de M2 (backend + frontend) en Docker Hub.
#
# Uso:
#   ./scripts/push-images.sh                 # build local + push (tag :api y :client)
#   ./scripts/push-images.sh --tag v2        # además agrega los tags :api-v2 y :client-v2
#   ./scripts/push-images.sh --multiarch     # build multiplataforma (amd64 + arm64) con buildx
#
# Requisitos: estar logueado con `docker login`.

set -euo pipefail

REPO="leangau/integration-m2-ae2"
EXTRA_TAG=""
MULTIARCH="false"

# ── Parseo de argumentos ──────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --tag)
      EXTRA_TAG="${2:-}"
      shift 2
      ;;
    --multiarch)
      MULTIARCH="true"
      shift
      ;;
    *)
      echo "Argumento desconocido: $1" >&2
      exit 1
      ;;
  esac
done

# El directorio raíz del repo es el padre de scripts/
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "==> Repositorio: ${REPO}"
echo "==> Raíz:        ${ROOT_DIR}"
[[ -n "$EXTRA_TAG" ]] && echo "==> Tag extra:   ${EXTRA_TAG}"
echo ""

# ── Verificación previa: que ambos proyectos compilen ─────────────────────────
echo "==> Verificando build del backend…"
npm run build >/dev/null
echo "    backend OK"

echo "==> Verificando build del frontend…"
( cd client && npm run build >/dev/null )
echo "    frontend OK"
echo ""

# ── Construcción de la lista de tags por imagen ───────────────────────────────
api_tags=("${REPO}:api")
client_tags=("${REPO}:client")
if [[ -n "$EXTRA_TAG" ]]; then
  api_tags+=("${REPO}:api-${EXTRA_TAG}")
  client_tags+=("${REPO}:client-${EXTRA_TAG}")
fi

# Arma los flags -t repetidos para docker build
api_flags=(); for t in "${api_tags[@]}"; do api_flags+=(-t "$t"); done
client_flags=(); for t in "${client_tags[@]}"; do client_flags+=(-t "$t"); done

if [[ "$MULTIARCH" == "true" ]]; then
  # ── Build + push multiplataforma en un solo paso (buildx) ───────────────────
  echo "==> Build multiplataforma (linux/amd64, linux/arm64) + push…"
  docker buildx build --platform linux/amd64,linux/arm64 "${api_flags[@]}"    --push .
  docker buildx build --platform linux/amd64,linux/arm64 "${client_flags[@]}" --push ./client
else
  # ── Build local y push por separado ─────────────────────────────────────────
  echo "==> Build de la imagen API…"
  docker build "${api_flags[@]}" .

  echo "==> Build de la imagen client…"
  docker build "${client_flags[@]}" ./client

  echo "==> Push de todos los tags…"
  for t in "${api_tags[@]}" "${client_tags[@]}"; do
    echo "    pushing ${t}"
    docker push "$t"
  done
fi

echo ""
echo "✓ Listo. Imágenes publicadas:"
for t in "${api_tags[@]}" "${client_tags[@]}"; do
  echo "    ${t}"
done
echo ""
echo "Para que tu compose local use las imágenes nuevas:"
echo "    docker compose down && docker compose pull && docker compose up -d"
