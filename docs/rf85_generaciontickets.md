# RF8.5 — Demostración HTTP de tickets de soporte

Este instructivo prueba RF8.5 contra la aplicación integrada `m8-app` en
`http://localhost:3000`. Las llamadas son HTTP reales: los tickets y su
historial se persisten en PostgreSQL. No son mocks ni respuestas preparadas.

La demostración manual complementa las pruebas automatizadas. Las suites de
Support verifican de forma repetible creación, idempotencia, concurrencia,
transiciones, historial, persistencia y recuperación ante una caída de la base.

## 1. Preparar el entorno

Abrir PowerShell en `modulo-8` y levantar la aplicación integrada:

```powershell
Copy-Item .env.example .env -ErrorAction SilentlyContinue
Remove-Item Env:M8_IMAGE -ErrorAction SilentlyContinue
docker compose --env-file .env up -d --build
docker compose --env-file .env ps
Invoke-WebRequest http://localhost:3000/health/live -UseBasicParsing
```

El último comando debe devolver `200`. Si se consulta `/health/ready`, un
`503` no implica que Node se haya detenido: indica que alguna dependencia de
readiness no está disponible.

## 2. Ejecutar la demostración HTTP

Copiar el bloque completo en la misma consola. Cada llamada imprime su código
HTTP y el cuerpo recibido.

```powershell
$M8 = "http://localhost:3000"

function Llamar {
  param($Metodo, $Url, $Body = $null, $Headers = @{})

  $params = @{
    Method = $Metodo
    Uri = $Url
    Headers = $Headers
    UseBasicParsing = $true
  }

  if ($null -ne $Body) {
    $params.Body = $Body | ConvertTo-Json
    $params.ContentType = "application/json"
  }

  try {
    $respuesta = Invoke-WebRequest @params
    $status = [int]$respuesta.StatusCode
    $content = $respuesta.Content
  } catch {
    $status = if ($_.Exception.Response) {
      [int]$_.Exception.Response.StatusCode
    } else {
      0
    }
    $content = if ($_.ErrorDetails.Message) {
      $_.ErrorDetails.Message
    } else {
      $_.Exception.Message
    }
  }

  Write-Host "HTTP $status" -ForegroundColor Cyan
  Write-Host $content

  if ($content -and $content.TrimStart().StartsWith("{")) {
    return $content | ConvertFrom-Json
  }
}

$trip = "demo-rf85-$([guid]::NewGuid())"
$clave = "clave-$trip"

# 1. Crear ticket: 201, estado ABIERTO y versión 1.
$ticket = Llamar POST "$M8/tickets" `
  @{ tripId = $trip; motivo = "Cobro duplicado" } `
  @{ "Idempotency-Key" = $clave; "X-Actor-Id" = "pasajero-1" }

# 2. Reintento idéntico: 200 y el mismo ticket, sin duplicarlo.
$mismoTicket = Llamar POST "$M8/tickets" `
  @{ tripId = $trip; motivo = "Cobro duplicado" } `
  @{ "Idempotency-Key" = $clave; "X-Actor-Id" = "pasajero-1" }

Write-Host "Mismo id: $($ticket.id -eq $mismoTicket.id)" -ForegroundColor Green

# 3. Misma clave con otro pedido: 409 SUPPORT_IDEMPOTENCY_CONFLICT.
$null = Llamar POST "$M8/tickets" `
  @{ tripId = $trip; motivo = "Otro motivo" } `
  @{ "Idempotency-Key" = $clave; "X-Actor-Id" = "pasajero-1" }

# 4. Cambio válido: 200 y versión 2.
$null = Llamar PATCH "$M8/tickets/$($ticket.id)/estado" `
  @{ estado = "EN_PROCESO"; expectedVersion = 1 } `
  @{ "X-Actor-Id" = "agente-1" }

# 5. Cambio con versión vieja: 409 SUPPORT_CONCURRENCY_CONFLICT.
$null = Llamar PATCH "$M8/tickets/$($ticket.id)/estado" `
  @{ estado = "EN_PROCESO"; expectedVersion = 1 } `
  @{ "X-Actor-Id" = "agente-1" }

# 6. Resolver: 200.
$null = Llamar PATCH "$M8/tickets/$($ticket.id)/estado" `
  @{ estado = "RESUELTO" } `
  @{ "X-Actor-Id" = "agente-1" }

# 7. Transición prohibida RESUELTO -> EN_PROCESO: 409.
$null = Llamar PATCH "$M8/tickets/$($ticket.id)/estado" `
  @{ estado = "EN_PROCESO" } `
  @{ "X-Actor-Id" = "agente-1" }

# 8. Reapertura sin motivo: 400.
$null = Llamar PATCH "$M8/tickets/$($ticket.id)/estado" `
  @{ estado = "ABIERTO" } `
  @{ "X-Actor-Id" = "agente-2" }

# 9. Reapertura con motivo: 200.
$null = Llamar PATCH "$M8/tickets/$($ticket.id)/estado" `
  @{ estado = "ABIERTO"; motivo = "El cobro volvió a aparecer" } `
  @{ "X-Actor-Id" = "agente-2" }

# 10. Historial, listado e inexistente: 200, 200 y 404 respectivamente.
$null = Llamar GET "$M8/tickets/$($ticket.id)/historial"
$null = Llamar GET "$M8/tickets?tripId=$trip"
$null = Llamar GET "$M8/tickets/00000000-0000-0000-0000-000000000000"
```

## 3. Recuperación opcional de PostgreSQL

Este bloque detiene sólo PostgreSQL durante unos segundos. El proceso M8 sigue
vivo, pero Support responde `503 SUPPORT_DB_UNAVAILABLE` porque no puede
persistir. Al recuperar la base, el ticket creado antes continúa disponible.

Ejecutarlo sólo después del bloque anterior, sin detener `m8-app`:

```powershell
docker compose --env-file .env stop postgres
Start-Sleep -Seconds 3

$null = Llamar POST "$M8/tickets" `
  @{ tripId = "demo-sin-base"; motivo = "Prueba de disponibilidad" }

docker compose --env-file .env start postgres
Start-Sleep -Seconds 10

$null = Llamar GET "$M8/tickets/$($ticket.id)"
```

## 4. Pruebas automatizadas

Con PostgreSQL disponible:

```powershell
pnpm --filter m8-soporte test
pnpm --filter m8-soporte test:integration
pnpm run test
pnpm run test:e2e
```

Las pruebas automatizadas son la evidencia repetible. La demostración HTTP
anterior permite mostrar en vivo el mismo comportamiento contra la aplicación
integrada y la persistencia reales.

## 5. Finalizar

Si ya no se necesita el entorno:

```powershell
docker compose --env-file .env down --remove-orphans
```

## 6. Con integraciones M6 y M1

Todo lo anterior corresponde al modo normal de `compose.yaml`, donde Support
no consulta a otros módulos. Con las integraciones habilitadas cambian dos
cosas: el viaje se verifica contra M6 y las rutas de `/tickets` exigen un
token de M1.

| Variable | Por defecto | Efecto |
| --- | --- | --- |
| `M6_TRIPS_URL` | sin definir | URL base de M6. Si está definida, `POST /tickets` verifica que el viaje exista (`GET /api/viajes/{id}`). |
| `M6_TIMEOUT_MS` | `2000` | Espera máxima de cada consulta a M6. |
| `SUPPORT_M1_IDENTITY_URL` | sin definir | URL base de M1. Si está definida, todas las rutas de `/tickets` exigen `Authorization: Bearer <token>`, que se valida con `GET /auth/validar-identidad-y-rol`. |
| `M1_TIMEOUT_MS` | `2000` | Espera máxima de cada consulta a M1. |

Con autenticación, el autor que queda en el historial es `m1:<userId>` y
`X-Actor-Id` se ignora. El `tripId` tiene que ser el id de un viaje real de
M6: un valor inventado, como el de la demostración anterior, responde `422`.

| Código | Respuesta | Cuándo |
| --- | --- | --- |
| `401` | `SUPPORT_AUTH_REQUIRED` | Falta la cabecera `Authorization`. Incluye `WWW-Authenticate: Bearer`. |
| `401` | `SUPPORT_INVALID_TOKEN` | La cabecera no es `Bearer <token>`, o M1 no acepta el token. Incluye `WWW-Authenticate: Bearer`. |
| `422` | `SUPPORT_TRIP_NOT_FOUND` | M6 no tiene un viaje con ese `tripId`. No se crea el ticket. |
| `503` | `SUPPORT_TRIP_SERVICE_UNAVAILABLE` | M6 no responde a tiempo o está caído. Incluye `Retry-After: 5`. No se crea el ticket. |
| `503` | `SUPPORT_IDENTITY_UNAVAILABLE` | M1 no responde a tiempo o está caído. Incluye `Retry-After: 5`. |

Cómo levantar M8 junto a los servicios reales de M6 y M1, y obtener un viaje y
un token reales: [`infra/integracion-real/README.md`](../infra/integracion-real/README.md).
