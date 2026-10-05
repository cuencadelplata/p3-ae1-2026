# Ensayo local de resiliencia RF-2.1

Este procedimiento es local y reversible. Usa el Compose del proyecto y conserva su volumen de PostgreSQL. No ejecutar `docker compose down -v`: ese comando borra los datos locales.

El ensayo requiere `db-profiles` y `redis` del Compose actual y una API local con `STUBS_ENABLED=true`. Antes de empezar, verificar que los puertos `3010`, `5433` y `6379` estén disponibles. El Compose fija nombres de contenedor y puertos, por lo que no se puede iniciar una segunda copia aislada mientras el stack habitual está activo. Si ya está activo, reutilizar sus dependencias sin reinicializar el volumen.

## Preparar recursos

Desde la raíz del repositorio, validar el modelo y levantar PostgreSQL y Redis:

```powershell
$compose = @('-f', 'docker-compose.yml')
docker compose @compose config --services
docker compose @compose up -d db-profiles redis
docker compose @compose ps
```

El API local apunta a los puertos publicados por Compose:

```powershell
$env:PORT = '3010'
$env:DB_HOST = 'localhost'
$env:DB_PORT = '5433'
$env:REDIS_URL = 'redis://localhost:6379'
$env:STUBS_ENABLED = 'true'
$env:M1_SERVICE_URL = 'http://localhost:3010/__stubs/m1'
$env:SOPORTE_SERVICE_URL = 'http://localhost:3010/__stubs/soporte'
$env:M6_SERVICE_URL = 'http://localhost:3010/__stubs/m6'
npm run dev
```

La comprobación obligatoria es que `docker compose @compose ps` muestre PostgreSQL y Redis saludables y que `curl.exe http://localhost:3010/health` responda.

El volumen de PostgreSQL puede contener un esquema anterior aunque el contenedor esté saludable. Antes del ensayo, comprobar que `CustomerProfile` tiene `user_id` y que su restricción única se llama `customerprofile_user_id_key`:

```powershell
docker exec p3-db-profiles psql -U postgres -d profiles -c '\d customers.CustomerProfile'
```

Si falta `user_id`, detener el ensayo y preparar una base con el esquema actual. La migración puntual de C13 solo corresponde a una base que ya tiene las tablas actuales y todavía conserva la columna duplicada `CustomerProfile.status`:

```powershell
docker exec p3-db-profiles psql -U postgres -d profiles -c "ALTER TABLE customers.CustomerProfile DROP COLUMN IF EXISTS status;"
```

## Crear token y perfil de prueba

Los endpoints bajo `/__stubs` solo sirven para este ensayo y no aparecen en OpenAPI. Crear un token para el usuario semilla `12`, crear su perfil y conservar el token en la sesión de PowerShell:

```powershell
$tokenBody = @{ userId = 12; role = 'CLIENTE' } | ConvertTo-Json
$token = (Invoke-RestMethod -Method Post `
  -Uri 'http://localhost:3010/__stubs/m1/auth/token-de-prueba' `
  -ContentType 'application/json' -Body $tokenBody).token

$headers = @{ Authorization = "Bearer $token" }
Invoke-RestMethod -Method Post -Uri 'http://localhost:3010/v1/customers' `
  -Headers $headers -ContentType 'application/json' `
  -Body '{"preferences":{"preferredVehicleType":"auto","notificationChannel":"email"}}'
```

Si el perfil ya existe, conservar el `customerId` devuelto por `GET /v1/customers/me` y continuar. El `409 ProfileAlreadyExists` confirma que la identidad ya está vinculada. Guardar el ID para las lecturas por ID:

```powershell
$customerId = (Invoke-RestMethod -Uri 'http://localhost:3010/v1/customers/me' -Headers $headers).customerId
```

## Caché fría y caliente

La primera lectura del perfil debe consultar PostgreSQL y marcar `X-Data-Source: database`; la segunda debe salir de la caché y marcar `X-Data-Source: cache`. Capturar las cabeceras hace observable el resultado:

```powershell
curl.exe -i -H "Authorization: Bearer $token" `
  "http://localhost:3010/v1/customers/$customerId"
curl.exe -i -H "Authorization: Bearer $token" `
  "http://localhost:3010/v1/customers/$customerId"
```

Guardar ambas respuestas en un directorio de evidencia del intento. La primera lectura es la condición fría; la segunda, la condición caliente. Si se necesita repetir la condición fría, reiniciar solo Redis con `docker compose @compose restart redis` y repetir la lectura; el volumen de PostgreSQL no se elimina.

## M1 caído y fallos acotados

Primero vaciar la caché de validación reiniciando Redis y dejar listo un token en la variable de PowerShell. Luego ordenar al stub de M1 que corte las conexiones:

```powershell
docker compose @compose restart redis
Invoke-RestMethod -Method Post `
  -Uri 'http://localhost:3010/__stubs/m1/__chaos' `
  -ContentType 'application/json' -Body '{"mode":"down"}'

$watch = [System.Diagnostics.Stopwatch]::StartNew()
$status = curl.exe -sS -D - -o .\m1-down-body.json `
  -H "Authorization: Bearer $token" `
  -w "`nHTTP_STATUS=%{http_code}`n" `
  http://localhost:3010/v1/customers/me
$watch.Stop()
$status
"ELAPSED_MS=$($watch.ElapsedMilliseconds)"
```

El observable esperado es `HTTP_STATUS=503`, un header `Retry-After` y una duración acotada por el timeout y los reintentos de la política `m1`. El body debe identificar `ServiceUnavailable`. Una lectura autenticada repetida con la validación todavía caliente puede continuar; esa es la comprobación de que el caché de identidad respeta el TTL.

Restaurar el stub y comprobar que el servicio vuelve a responder:

```powershell
Invoke-RestMethod -Method Post `
  -Uri 'http://localhost:3010/__stubs/m1/__chaos' `
  -ContentType 'application/json' -Body '{}'
Invoke-RestMethod -Uri 'http://localhost:3010/health'
```

## PostgreSQL y Redis fuera de servicio

Detener únicamente cada dependencia, observar el resultado y levantarla de nuevo. Reiniciar Redis antes de detener PostgreSQL para que la lectura del perfil no salga de un caché caliente. No usar `down -v` ni `docker volume rm`:

```powershell
docker compose @compose restart redis
docker compose @compose stop db-profiles
curl.exe -i -H "Authorization: Bearer $token" "http://localhost:3010/v1/customers/$customerId"
docker compose @compose start db-profiles
Start-Sleep -Seconds 31
curl.exe -i -H "Authorization: Bearer $token" "http://localhost:3010/v1/customers/$customerId"

docker compose @compose stop redis
curl.exe -i -H "Authorization: Bearer $token" "http://localhost:3010/v1/customers/$customerId"
curl.exe -i http://localhost:3010/health
docker compose @compose start redis
```

PostgreSQL caído debe producir `503` con `Retry-After`; Redis caído debe permitir `GET /:id` con `200` y `X-Data-Source: database`. `/health` debe responder `200 DEGRADED` con solo Redis caído y `503 DEGRADED` con PostgreSQL caído.

## Soporte y M6 fuera de servicio

Guardar primero un estado con Soporte disponible. Después activar su caída y confirmar que `/status` devuelve el último estado guardado:

```powershell
$savedStatus = Invoke-RestMethod -Uri "http://localhost:3010/v1/customers/$customerId/status" -Headers $headers
Invoke-RestMethod -Method Post -Uri 'http://localhost:3010/__stubs/soporte/__chaos' -ContentType 'application/json' -Body '{"mode":"down"}'
$fallbackStatus = Invoke-RestMethod -Uri "http://localhost:3010/v1/customers/$customerId/status" -Headers $headers
$savedStatus.status; $fallbackStatus.status
Invoke-RestMethod -Method Post -Uri 'http://localhost:3010/__stubs/soporte/__chaos' -ContentType 'application/json' -Body '{}'
```

Con M6 caído, `/trips` debe responder `200` con `degraded: true` para distinguir la caída de una lista de viajes vacía:

```powershell
Invoke-RestMethod -Method Post -Uri 'http://localhost:3010/__stubs/m6/__chaos' -ContentType 'application/json' -Body '{"mode":"down"}'
Invoke-RestMethod -Uri "http://localhost:3010/v1/customers/$customerId/trips" -Headers $headers
Invoke-RestMethod -Method Post -Uri 'http://localhost:3010/__stubs/m6/__chaos' -ContentType 'application/json' -Body '{}'
```

## Restablecimiento

Restablecer los stubs y arrancar las dependencias cuando ya se hayan guardado las capturas:

```powershell
Invoke-RestMethod -Method Post `
  -Uri 'http://localhost:3010/__stubs/m1/__chaos' `
  -ContentType 'application/json' -Body '{}'
docker compose @compose start db-profiles redis
docker compose @compose ps
```

Dejar el stack en el estado en que estaba antes del ensayo. El estado de ejecución y las capturas pertenecen al intento de QA; este documento no afirma que el ensayo haya pasado hasta que existan respuestas reales para caché fría/caliente, `Retry-After`, Redis degradado, Soporte y M6.
