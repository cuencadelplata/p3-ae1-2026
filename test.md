# Demostración y verificación completa — M8 AE2

Esta guía prueba la aplicación integrada `m8-app`: un único proceso HTTP que
contiene Notifications, QR, Receipts, Support y Delivery. PostgreSQL, Redis y
RabbitMQ son dependencias compartidas ejecutadas por Docker Compose.

M8 no inicia viajes ni modifica `EN_CURSO`; esa responsabilidad sigue siendo
de M6.

## 1. Preparación limpia

Abrir PowerShell en la raíz del repositorio y entrar una única vez al módulo:

```powershell
Set-Location .\modulo-8
Copy-Item .env.example .env -ErrorAction SilentlyContinue
docker compose --env-file .env down --remove-orphans
```

`down` detiene sólo el entorno de demostración. No borra las imágenes ni el
volumen de PostgreSQL porque no se utiliza `-v`.

## 2. Instalar, compilar y ejecutar pruebas del workspace

```powershell
pnpm install --frozen-lockfile
pnpm run build
pnpm run test
```

`pnpm run test` prepara PostgreSQL, Redis, RabbitMQ y los sandboxes que
necesitan sus suites. No es necesario detener manualmente `m8-app`: si no está
levantada, el comando prepara sólo la infraestructura de pruebas.

## 3. Descargar y levantar la imagen integrada publicada

La imagen AE2 necesita infraestructura compartida, por lo que se ejecuta con
Compose y no con un `docker run` aislado.

```powershell
docker image ls juanmainval/m8-notificaciones-qr
docker pull juanmainval/m8-notificaciones-qr:2.0.1
$env:M8_IMAGE = "juanmainval/m8-notificaciones-qr:2.0.1"
docker compose --env-file .env up -d --no-build
docker compose --env-file .env ps
```

Se espera ver estos servicios: `m8-app`, `postgres`, `redis`, `rabbitmq`,
`fiscal-sandbox`, `m1-identity-sandbox` y `m7-payments-sandbox`. La única
aplicación HTTP M8 debe publicar `0.0.0.0:3000->3000/tcp`.

## 4. Esperar a que la aplicación esté lista

```powershell
$ready = $false

for ($i = 1; $i -le 30; $i++) {
  try {
    $health = Invoke-WebRequest http://localhost:3000/health/ready -UseBasicParsing
    if ($health.StatusCode -eq 200) {
      $ready = $true
      break
    }
  } catch {
    # La aplicación o una dependencia aún se está iniciando.
  }
  Start-Sleep -Seconds 2
}

if (-not $ready) {
  docker compose --env-file .env logs --tail=100 m8-app
  throw "M8 no llegó a estado ready en 60 segundos."
}

$health.Content
```

Verificar los tres health checks:

```powershell
Invoke-WebRequest http://localhost:3000/health/live -UseBasicParsing
Invoke-RestMethod http://localhost:3000/health/ready | ConvertTo-Json -Depth 8
Invoke-RestMethod http://localhost:3000/health | ConvertTo-Json -Depth 8
```

- `/health/live` devuelve `200` cuando el proceso Node sigue vivo.
- `/health/ready` y `/health` devuelven `200` si las dependencias críticas
  están disponibles y `503` si alguna no lo está. Un `503` aquí es un estado
  informado, no significa que la aplicación se haya caído.

## 5. Ver documentación y contrato

Abrir en el navegador:

```text
http://localhost:3000/docs
```

Es Scalar, la interfaz navegable del contrato OpenAPI integrado. El archivo
fuente se obtiene en:

```text
http://localhost:3000/openapi.yaml
```

Es normal que el navegador descargue el YAML; para verlo y probar operaciones
en forma visual se usa `/docs`. El contrato utiliza OpenAPI `3.0.3` y su
versión integrada actual es `2.0.1`.

## 6. Verificar infraestructura compartida

```powershell
pnpm run test:infrastructure
```

La suite comprueba que PostgreSQL tiene los schemas lógicos del módulo, Redis
responde, RabbitMQ está disponible y existen `mobility.events` y
`mobility.events.dlx`.

## 7. Ejecutar End-to-End y resiliencia

```powershell
pnpm run test:e2e
```

Esta ejecución prueba la API integrada: notificaciones, QR de un solo uso,
comprobantes, reenvíos, tickets, mensajería y health. Luego ejecuta la suite
de resiliencia. Puede tardar varios minutos porque simula caídas controladas y
restaura Redis, RabbitMQ, PostgreSQL y los sandboxes al terminar.

Para ejecutar sólo esa parte de recuperación:

```powershell
pnpm run test:resiliencia
```

## 8. Demostración manual de aislamiento con Redis

Esta prueba muestra que una dependencia puede caer sin derribar todo M8.

```powershell
$tripId = "demo-redis-$([guid]::NewGuid().ToString())"
$recipientId = "user-demo-$([guid]::NewGuid().ToString())"

docker compose --env-file .env stop redis
Start-Sleep -Seconds 3

Invoke-WebRequest http://localhost:3000/health/live -UseBasicParsing

try {
  Invoke-RestMethod http://localhost:3000/health/ready | ConvertTo-Json -Depth 8
} catch {
  $_.ErrorDetails.Message | ConvertFrom-Json | ConvertTo-Json -Depth 8
}
```

Se espera `200` en `live` y un estado degradado o no disponible en `ready`.
Probar que Notifications sigue respondiendo:

```powershell
$notificationBody = @{
  tripId = $tripId
  recipientId = $recipientId
  eventType = "DRIVER_ASSIGNED"
  channels = @("PUSH")
} | ConvertTo-Json

Invoke-RestMethod -Method Post `
  -Uri http://localhost:3000/notifications `
  -ContentType "application/json" `
  -Body $notificationBody
```

Probar que QR falla de manera controlada, porque necesita Redis para TTL y
consumo atómico:

```powershell
$qrBody = @{ tripId = $tripId } | ConvertTo-Json

try {
  Invoke-WebRequest -Method Post `
    -Uri http://localhost:3000/qr `
    -ContentType "application/json" `
    -Body $qrBody `
    -UseBasicParsing
} catch {
  "HTTP $($_.Exception.Response.StatusCode.value__)"
}
```

Restaurar Redis y confirmar recuperación:

```powershell
docker compose --env-file .env start redis
Start-Sleep -Seconds 5
Invoke-RestMethod http://localhost:3000/health/ready | ConvertTo-Json -Depth 8
```

El resultado esperado es: Redis cae, QR no procesa de forma insegura,
Notifications continúa disponible, el proceso M8 no se cae y la disponibilidad
se recupera al restaurar Redis.

## 9. Demostración funcional de Support

La guía HTTP real de creación, idempotencia, concurrencia, historial y
recuperación de tickets está en:

```text
docs/rf85_generaciontickets.md
```

## 10. Cierre

```powershell
docker compose --env-file .env down --remove-orphans
docker compose --env-file .env ps
docker image ls juanmainval/m8-notificaciones-qr
```

El apagado borra los contenedores y la red del stack; las imágenes descargadas
permanecen locales y la próxima demostración puede omitir `docker pull` si la
etiqueta `2.0.1` ya aparece en el listado.
