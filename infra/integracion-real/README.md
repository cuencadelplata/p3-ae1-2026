# Integración real de Support (RF8.5) con M6 y M1

Pasos para levantar M8 junto a los servicios **reales** de M6 (viajes) y M1
(identidad) en una misma máquina. No hay sandboxes ni mocks de esos módulos:
se construyen desde sus ramas.

| Archivo | Para qué |
| --- | --- |
| `../../compose.integracion-real.yaml` | Se suma a `compose.yaml`. Une `m8-app` a las redes de M6 y M1 y define `M6_TRIPS_URL` y `SUPPORT_M1_IDENTITY_URL`. |
| `m6.override.yaml` | Se suma al `docker-compose.yml` de M6. Sólo cambia puertos publicados. |
| `m1.override.yaml` | Se suma al `docker-compose.yml` de M1. Sólo cambia puertos publicados. |

Los overrides existen porque los tres módulos publican los mismos puertos en
el host (3000, 3001, 5432, 6379, 5672, 15672). No tocan imágenes, comandos,
variables ni código de M6 o M1.

| Servicio | Puerto en el host | Dentro de Docker |
| --- | --- | --- |
| M8 | 3000 | `m8-app:3000` |
| M6 viajes | 13000 | `viajes:3000` |
| M1 | 13001 | `m1-identidad-acceso:3001` |

Los demás servicios de M6 y M1 (bases, Redis, RabbitMQ, cancelaciones,
fachada) no publican puertos.

## Requisitos

- Docker Compose 2.24 o superior (los overrides usan `!override` y `!reset`).
- `modulo-8/.env` creado a partir de `.env.example`.
- Ramas usadas: M6 `ae2/m6-codutti-diez-mordka-mortola`, M1
  `integration/m1-ae2`.

Los comandos son para Git Bash y se ejecutan desde la raíz del repositorio.

## 1. Traer el código de M6 y M1

En worktrees fuera del repositorio, para no cambiar de rama:

```bash
git fetch origin
TMP="$(mktemp -d)"
git worktree add --detach "$TMP/m6" origin/ae2/m6-codutti-diez-mordka-mortola
git worktree add --detach "$TMP/m1" origin/integration/m1-ae2
OVR="$PWD/modulo-8/infra/integracion-real"
```

## 2. Levantar M6 y M1

```bash
docker compose -p m6-integracion \
  -f "$TMP/m6/modulo6/docker-compose.yml" -f "$OVR/m6.override.yaml" \
  up -d --build --wait

docker compose -p m1-integracion \
  -f "$TMP/m1/modulo-1-identidad-acceso/docker-compose.yml" -f "$OVR/m1.override.yaml" \
  up -d --build --wait
```

Los nombres de proyecto importan: `compose.integracion-real.yaml` espera las
redes `m6_viajes_default` (la fija el compose de M6) y
`m1-integracion_default` (la red por defecto del proyecto `m1-integracion`).
Si se usan otros nombres, definir `M6_NETWORK` y `M1_NETWORK`.

## 3. Levantar M8 conectado a ellos

```bash
cd modulo-8
docker compose --env-file .env -f compose.yaml -f compose.integracion-real.yaml \
  up -d --build --wait
```

`GET http://localhost:3000/health/ready` debe mostrar, dentro de
`modules.support.checks`, `trips` e `identity` en `available`.

Mientras M8 esté unido a las redes de M6 y M1, los nombres `redis` y
`rabbitmq` existen en más de una red. Por eso el archivo de integración repite
las URLs de infraestructura de M8 con los alias `m8-postgres`, `m8-redis` y
`m8-rabbitmq`. Si se cambian en `compose.yaml`, hay que cambiarlas también ahí.

## 4. Obtener un viaje real (M6)

```bash
curl -s -X POST http://localhost:13000/api/viajes \
  -H "content-type: application/json" \
  -d '{"clienteId":"cliente-1","origen":"Origen 123","destino":"Destino 456"}'
```

Responde `201` con el viaje. Su `id` es el `tripId` para Support. Se puede
copiar de la respuesta o guardar en una variable:

```bash
TRIP_ID=$(curl -s -X POST http://localhost:13000/api/viajes \
  -H "content-type: application/json" \
  -d '{"clienteId":"cliente-1","origen":"Origen 123","destino":"Destino 456"}' \
  | node -e "process.stdin.on('data', d => console.log(JSON.parse(d).id))")
```

## 5. Obtener un token real (M1)

```bash
curl -s -X POST http://localhost:13001/auth/registrar-usuario \
  -H "content-type: application/json" \
  -d '{"nombre":"<NOMBRE>","apellido":"<APELLIDO>","dni":"<DNI>","telefono":"<TELEFONO>","email":"<EMAIL>","password":"<CONTRASEÑA>","rol":"CLIENTE"}'

curl -s -X POST http://localhost:13001/auth/iniciar-sesion \
  -H "content-type: application/json" \
  -d '{"email":"<EMAIL>","password":"<CONTRASEÑA>"}'
```

Los valores entre `< >` son marcadores: reemplazarlos por valores de prueba
cualquiera, nunca por datos ni contraseñas reales. M1 exige que el email y el
DNI no estén registrados; la contraseña tiene que cumplir sus reglas de
validación.

El login responde `{ token, tokenType: "Bearer", expiresIn: "1h", usuario }`.
El registro público sólo admite los roles `CLIENTE` y `CONDUCTOR`.

Para guardar el token en una variable, en lugar de copiarlo:

```bash
TOKEN=$(curl -s -X POST http://localhost:13001/auth/iniciar-sesion \
  -H "content-type: application/json" \
  -d '{"email":"<EMAIL>","password":"<CONTRASEÑA>"}' \
  | node -e "process.stdin.on('data', d => console.log(JSON.parse(d).token))")
```

El token vence a la hora: después, volver a iniciar sesión. Registrar dos
veces el mismo email o DNI responde `409`; en una segunda corrida sobre el
mismo stack, saltear el registro e iniciar sesión directamente, o usar otros
datos.

## 6. Crear un ticket

```bash
curl -s -X POST http://localhost:3000/tickets \
  -H "content-type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{"tripId":"<id del viaje>","motivo":"Demora"}'
```

| Caso | Respuesta |
| --- | --- |
| Token y viaje reales | `201`; el historial registra `cambiadoPor: "m1:<userId>"` |
| Viaje que M6 no conoce | `422 SUPPORT_TRIP_NOT_FOUND` |
| Sin `Authorization` | `401 SUPPORT_AUTH_REQUIRED` |
| Token que M1 rechaza | `401 SUPPORT_INVALID_TOKEN` |
| `docker stop m6-integracion-viajes-1` | `503 SUPPORT_TRIP_SERVICE_UNAVAILABLE` con `Retry-After: 5` |
| `docker stop m1-identidad-acceso` | `503 SUPPORT_IDENTITY_UNAVAILABLE` con `Retry-After: 5` |

## 7. Volver al modo normal y limpiar

Primero M8, para que suelte las redes de M6 y M1:

```bash
cd modulo-8
docker compose --env-file .env up -d --wait
cd ..

docker compose -p m6-integracion \
  -f "$TMP/m6/modulo6/docker-compose.yml" -f "$OVR/m6.override.yaml" down -v
docker compose -p m1-integracion \
  -f "$TMP/m1/modulo-1-identidad-acceso/docker-compose.yml" -f "$OVR/m1.override.yaml" down -v

git worktree remove --force "$TMP/m6"
git worktree remove --force "$TMP/m1"
rm -rf "$TMP"
```

Opcional, para liberar espacio: borrar las imágenes construidas en el paso 2.

```bash
docker rmi p3-ae1-2026-modulo6:local p3-ae1-2026-modulo6-db:local matsir/m1-identidad-acceso:latest
```

El paso 3 reconstruye `modulo-8-m8-app:local` con el código de la rama. Si
antes `m8-app` corría una imagen publicada, volver a ella sin construir:

```bash
cd modulo-8
M8_IMAGE=juanmainval/m8-notificaciones-qr:2.0.1 docker compose --env-file .env up -d --no-build --wait
```

`down -v` se usa sólo sobre los proyectos `m6-integracion` y `m1-integracion`,
cuyos volúmenes son descartables. **No usarlo sobre M8.**

## Variables opcionales

Se pueden definir en `modulo-8/.env` o en la línea de comandos. Ninguna es
obligatoria: los valores por defecto corresponden a estos pasos.

| Variable | Por defecto | Dónde se usa |
| --- | --- | --- |
| `M6_VIAJES_HOST` | `viajes` | Host de M6 para `m8-app` |
| `M1_HOST` | `m1-identidad-acceso` | Host de M1 para `m8-app` |
| `M6_TIMEOUT_MS` | `2000` | Espera máxima de cada consulta a M6 |
| `M6_NETWORK` | `m6_viajes_default` | Red externa de M6 |
| `M1_NETWORK` | `m1-integracion_default` | Red externa de M1 |
| `M6_VIAJES_HOST_PORT` | `13000` | Puerto del host para `viajes` (override de M6) |
| `M1_HOST_PORT` | `13001` | Puerto del host para M1 (override de M1) |

La espera máxima de cada consulta a M1 es `M1_TIMEOUT_MS`, la misma variable
que usa Receipts (`2000` por defecto en `compose.yaml`).

## Tildes en Git Bash sobre Windows

`curl -d` en Git Bash puede mandar el cuerpo con la codificación de la
consola en lugar de UTF-8, y un `motivo` con tildes o eñes se guarda mal. Para
estas pruebas, usar texto sin acentos, o escribir el cuerpo en un archivo
UTF-8 y enviarlo con `--data-binary @archivo.json`.

## Alcance

- Este modo sólo cambia la configuración de Support. Los demás RF de M8
  siguen como en `compose.yaml`; Receipts, por ejemplo, sigue validando contra
  `m1-identity-sandbox`.
- Con este modo activo, `POST /tickets` exige un Bearer y un viaje real. Las
  pruebas E2E de M8 (`pnpm test:e2e`) están escritas para el modo normal y no
  deben correrse contra este stack.
- Los tickets creados quedan en la base de M8; los viajes y usuarios se
  pierden al bajar M6 y M1 con `down -v`.
