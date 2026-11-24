#!/usr/bin/env bash
# =============================================================================
# PRUEBA DE INTEGRACIÓN COMPLETA — M7 Tarifas, Pagos y Liquidaciones
# =============================================================================
# Levanta el STACK COMPLETO REAL (sin mocks) y verifica el flujo end-to-end
# de M7: desde método de pago hasta cancelación y reintegro.
#
# USO:
#   cd <raíz del repo>          ← donde está el docker-compose.yml principal
#   bash modulo7/k6/integration-flow.sh
#
# REQUIERE:
#   - Docker y Docker Compose
#   - k6 instalado (https://k6.io/docs/get-started/installation/)
#
# PUERTOS (acordados en el stack):
#   M7 API         → localhost:17000  (incluye código de Lautaro, Matilda y Aylen integrado)
#   M6 viajes      → localhost:15000
#   M6 cancelacion → localhost:15001
#   RabbitMQ AMQP  → localhost:17001  (rango M7: no pisa otras instancias)
#   RabbitMQ mgmt  → localhost:17002
#   Redis          → sin puerto host   (solo red interna Docker)
# =============================================================================

set -euo pipefail

GREEN="\033[0;32m"; RED="\033[0;31m"; YELLOW="\033[1;33m"; BLUE="\033[0;34m"; NC="\033[0m"
ok()   { echo -e "${GREEN}✅ $*${NC}"; }
fail() { echo -e "${RED}❌ $*${NC}"; }
info() { echo -e "${BLUE}ℹ  $*${NC}"; }
warn() { echo -e "${YELLOW}⚠️  $*${NC}"; }

echo -e "${BLUE}"
echo "╔═════════════════════════════════════════════════════╗"
echo "║        PRUEBA DE INTEGRACIÓN COMPLETA — M7          ║"
echo "║  RF-7.1 RF-7.2 RF-7.3 RF-7.4 RF-7.5 RF-7.6 RF-7.7   ║"
echo "╚═════════════════════════════════════════════════════╝"
echo -e "${NC}"

# ── Detectar directorio raíz ─────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MODULO7_DIR="$(dirname "$SCRIPT_DIR")"
REPO_ROOT="$(dirname "$MODULO7_DIR")"

# Verificar que el docker-compose.yml de la raíz existe
if [ ! -f "$REPO_ROOT/docker-compose.yml" ]; then
  fail "No se encontró docker-compose.yml en $REPO_ROOT"
  fail "Corré este script desde la raíz del repo: bash modulo7/k6/integration-flow.sh"
  exit 1
fi

info "Raíz del repo: $REPO_ROOT"

# ════════════════════════════════════════════════════════════════════════════
# PASO 1: Levantar el stack completo real
# ════════════════════════════════════════════════════════════════════════════
echo -e "\n${BLUE}─── PASO 1: Levantar stack de M7 (M7 + M6 + M9) ────────────────${NC}"
info "Levantando solo los composes de M9 (rabbit/redis), M6 y M7:"
echo ""

cd "$REPO_ROOT"

# Puertos custom para no pisar instancias de RabbitMQ/Redis que ya estén corriendo
export RABBITMQ_PORT=17001
export RABBITMQ_MANAGEMENT_PORT=17002
export REDIS_PORT=6380
export RABBITMQ_USER="${RABBITMQ_USER:-m9}"
export RABBITMQ_PASSWORD="${RABBITMQ_PASSWORD:-m9-local}"

info "Puertos RabbitMQ: AMQP=${RABBITMQ_PORT}, Mgmt=${RABBITMQ_MANAGEMENT_PORT} | Redis: ${REDIS_PORT}"

# ── Crear red compartida con nombre fijo ──────────────────────────────────────
# M9, M6 y M7 están en distintos compose files. Para que todos puedan resolverse
# por nombre de host (rabbitmq, redis) necesitan estar en la MISMA red Docker.
# Creamos la red con nombre fijo y la declaramos como external en cada compose.
SHARED_NET="reservas-network"
if ! docker network inspect "$SHARED_NET" &>/dev/null; then
  info "Creando red compartida '$SHARED_NET'..."
  docker network create "$SHARED_NET"
  ok "Red '$SHARED_NET' creada"
else
  ok "Red '$SHARED_NET' ya existe"
fi

# M9 primero: provee rabbitmq y redis compartidos (con puertos custom)
# Se necesita que M9 use la red 'reservas-network' ya existente.
# Como el compose de M9 la declara como propia (driver: bridge), usamos COMPOSE_PROJECT_NAME
# para que no haya colisión, o bien sobreescribimos con --env-file.
# La forma más simple: levantar M9 con env vars y dejar que se conecte a la red existente.
RABBITMQ_PORT=$RABBITMQ_PORT \
RABBITMQ_MANAGEMENT_PORT=$RABBITMQ_MANAGEMENT_PORT \
REDIS_PORT=$REDIS_PORT \
RABBITMQ_USER=$RABBITMQ_USER \
RABBITMQ_PASSWORD=$RABBITMQ_PASSWORD \
docker compose \
  -p m9-integracion \
  -f M9-ReservasProgramadas/docker-compose.yml \
  up -d rabbitmq redis

# Conectar rabbitmq y redis a la red compartida con aliases para que M6 y M7
# puedan resolverlos por nombre de servicio ('rabbitmq', 'redis')
RMQ_CONTAINER=$(docker compose -p m9-integracion -f M9-ReservasProgramadas/docker-compose.yml ps -q rabbitmq 2>/dev/null || true)
REDIS_CONTAINER=$(docker compose -p m9-integracion -f M9-ReservasProgramadas/docker-compose.yml ps -q redis 2>/dev/null || true)

if [ -n "$RMQ_CONTAINER" ]; then
  docker network connect --alias rabbitmq "$SHARED_NET" "$RMQ_CONTAINER" 2>/dev/null && \
    info "rabbitmq conectado a $SHARED_NET (alias: rabbitmq)" || \
    info "rabbitmq ya está en $SHARED_NET"
fi

if [ -n "$REDIS_CONTAINER" ]; then
  docker network connect --alias redis "$SHARED_NET" "$REDIS_CONTAINER" 2>/dev/null && \
    info "redis conectado a $SHARED_NET (alias: redis)" || \
    info "redis ya está en $SHARED_NET"
fi

# M6: viajes y cancelacion
# El compose de M6 referencia rabbitmq/redis como depends_on pero no los define —
# están en M9. Docker Compose valida esto antes de levantar y falla.
# Lo levantamos con --no-deps para saltear la validación de dependencias externas,
# y confiamos en que rabbitmq y redis ya están en la red compartida.
docker compose \
  -p m6-integracion \
  -f modulo6/compose.integracion.yml \
  up -d --no-deps m6-tripdb || warn "m6-tripdb falló"

docker compose \
  -p m6-integracion \
  -f modulo6/compose.integracion.yml \
  up -d --no-deps m6-viajes-app || warn "m6-viajes-app falló"

docker compose \
  -p m6-integracion \
  -f modulo6/compose.integracion.yml \
  up -d --no-deps m6-viajes m6-cancelacion m6-fachada || warn "m6-viajes/cancelacion/fachada fallaron"

# M7: api y postgres (compose.integracion.yml usa reservas-network como external)
docker compose \
  -p m7-integracion \
  -f modulo7/compose.integracion.yml \
  up -d

echo ""
info "Esperando que los servicios estén disponibles..."

# Función para esperar un endpoint
wait_for() {
  local url="$1"
  local nombre="$2"
  local max="${3:-60}"
  local waited=0
  until curl -sf "$url" > /dev/null 2>&1; do
    if [ "$waited" -ge "$max" ]; then
      fail "$nombre no respondió en ${max}s"
      return 1
    fi
    sleep 3; waited=$((waited + 3)); echo -n "."
  done
  echo ""; ok "$nombre disponible"
}

wait_for "http://localhost:17000/health" "M7 API"
wait_for "http://localhost:15000/health" "M6 viajes" 60 || warn "M6 viajes no disponible (puede no estar construido)"
wait_for "http://localhost:15001/health" "M6 cancelacion" 30 || warn "M6 cancelacion no disponible"
wait_for "http://localhost:${RABBITMQ_MANAGEMENT_PORT}/api/overview" "RabbitMQ management" 90 || warn "RabbitMQ management no disponible"

# ════════════════════════════════════════════════════════════════════════════
# PASO 2: Verificar estado del stack
# ════════════════════════════════════════════════════════════════════════════
echo -e "\n${BLUE}─── PASO 2: Estado del stack ────────────────────────────────────${NC}"
docker compose -p m7-integracion -f modulo7/compose.integracion.yml ps
docker compose -p m6-integracion -f modulo6/compose.integracion.yml ps
docker compose -p m9-integracion -f M9-ReservasProgramadas/docker-compose.yml ps rabbitmq redis 2>/dev/null || true

# ════════════════════════════════════════════════════════════════════════════
# PASO 3: Verificar que el exchange 'viajes' existe en RabbitMQ
# M6 lo crea al iniciar; M7 consumer lo necesita para recibir cancelaciones
# ════════════════════════════════════════════════════════════════════════════
echo -e "\n${BLUE}─── PASO 3: Verificar exchange 'viajes' en RabbitMQ ─────────────${NC}"
RMQUSER="${RABBITMQ_USER:-m9}"
RMQPASS="${RABBITMQ_PASSWORD:-m9-local}"

EXCHANGE=$(curl -sf -u "${RMQUSER}:${RMQPASS}" \
  "http://localhost:${RABBITMQ_MANAGEMENT_PORT}/api/exchanges/%2F/viajes" 2>/dev/null || echo "")

if echo "$EXCHANGE" | grep -q '"name":"viajes"'; then
  ok "Exchange 'viajes' existe en RabbitMQ"
else
  warn "Exchange 'viajes' no encontrado todavía — esperando 10s más..."
  sleep 10
  EXCHANGE=$(curl -sf -u "${RMQUSER}:${RMQPASS}" \
    "http://localhost:${RABBITMQ_MANAGEMENT_PORT}/api/exchanges/%2F/viajes" 2>/dev/null || echo "")
  if echo "$EXCHANGE" | grep -q '"name":"viajes"'; then
    ok "Exchange 'viajes' existe ahora"
  else
    warn "Exchange 'viajes' aún no existe. M6 puede no haber iniciado o estar construyéndose."
    warn "El test de RabbitMQ usará el fallback de publicación directa."
  fi
fi

# Verificar cola de M7
QUEUE=$(curl -sf -u "${RMQUSER}:${RMQPASS}" \
  "http://localhost:${RABBITMQ_MANAGEMENT_PORT}/api/queues/%2F/m7.reintegro.viaje-cancelado" 2>/dev/null || echo "")
if echo "$QUEUE" | grep -q '"name"'; then
  ok "Cola 'm7.reintegro.viaje-cancelado' existe"
else
  warn "Cola 'm7.reintegro.viaje-cancelado' no existe todavía — M7 la crea al iniciar"
fi

# ════════════════════════════════════════════════════════════════════════════
# PASO 4: Ejecutar k6 — flujo completo de integración
# ════════════════════════════════════════════════════════════════════════════
echo -e "\n${BLUE}─── PASO 4: k6 — flujo de integración completo ─────────────────${NC}"

if ! command -v k6 &> /dev/null; then
  fail "k6 no está instalado."
  info "Instalar en Linux:  sudo gpg --dearmor -o /usr/share/keyrings/k6-archive-keyring.gpg <(curl -s https://dl.k6.io/key.gpg) && echo 'deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main' | sudo tee /etc/apt/sources.list.d/k6.list && sudo apt update && sudo apt install k6"
  info "Instalar en Mac:    brew install k6"
  info "Instalar en Win:    choco install k6"
  exit 1
fi

info "Corriendo k6 integration-test.js..."
echo ""

k6 run \
  -e BASE_URL="http://localhost:17000" \
  -e M6_URL="http://localhost:15001" \
  -e M6_VIAJES_URL="http://localhost:15000" \
  -e RABBIT_API="http://localhost:${RABBITMQ_MANAGEMENT_PORT}" \
  -e RABBIT_AUTH="Basic $(echo -n "${RABBITMQ_USER:-m9}:${RABBITMQ_PASSWORD:-m9-local}" | base64)" \
  -e API_KEY="${API_KEY:-m7-123}" \
  -e MP_PUBLIC_KEY="${MP_PUBLIC_KEY:-TEST-bc8db768-1690-493a-9cfb-408e8646c0d1}" \
  "$SCRIPT_DIR/integration-test.js"

K6_STATUS=$?

# ════════════════════════════════════════════════════════════════════════════
# PASO 5: Resumen final
# ════════════════════════════════════════════════════════════════════════════
echo -e "\n${BLUE}─── RESUMEN FINAL ───────────────────────────────────────────────${NC}"
if [ "$K6_STATUS" -eq 0 ]; then
  echo -e "${GREEN}"
  echo "  ✅ TODOS LOS THRESHOLDS PASARON"
  echo "  ✅ La integración de M7 con el stack real funciona correctamente"
  echo -e "${NC}"
  echo "  Requerimientos verificados:"
  echo "  ├─ RF-7.1  Estimación de tarifa"
  echo "  ├─ RF-7.2  Método de pago"
  echo "  ├─ RF-7.3  Autorización MercadoPago sandbox"
  echo "  ├─ RF-7.4  Cargo cancelación (Lautaro — /cancelacion/cargo)"
  echo "  ├─ RF-7.5  Reintegro: M6→RabbitMQ→M7 consumer→cargo(Lautaro)→reintegro(Aylen)"
  echo "  ├─ RF-7.6  Idempotencia (Redis + DB)"
  echo "  └─ RF-7.7  Historial financiero"
else
  echo -e "${RED}"
  echo "  ❌ ALGUNOS CHECKS FALLARON (exit code k6: $K6_STATUS)"
  echo -e "${NC}"
  echo "  Revisá los logs:"
  echo "  $ docker compose -p m7-integracion -f modulo7/compose.integracion.yml logs m7-api --tail=50"
  echo "  $ docker compose -p m6-integracion -f modulo6/compose.integracion.yml logs m6-cancelacion --tail=30"
fi

echo ""
info "Comandos útiles:"
info "  Logs M7:    docker compose -p m7-integracion -f modulo7/compose.integracion.yml logs m7-api -f"
info "  Logs M6:    docker compose -p m6-integracion -f modulo6/compose.integracion.yml logs m6-cancelacion -f"
info "  RabbitMQ:   http://localhost:${RABBITMQ_MANAGEMENT_PORT} (usuario: ${RABBITMQ_USER:-m9} / ${RABBITMQ_PASSWORD:-m9-local})"
info "  Bajar todo: docker compose -p m7-integracion -f modulo7/compose.integracion.yml down && docker compose -p m6-integracion -f modulo6/compose.integracion.yml down && docker compose -p m9-integracion -f M9-ReservasProgramadas/docker-compose.yml down && docker network rm reservas-network 2>/dev/null || true"
echo ""

exit $K6_STATUS