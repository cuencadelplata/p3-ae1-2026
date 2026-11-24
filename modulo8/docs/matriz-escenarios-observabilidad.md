# Guía de escenarios de M8: k6 y Grafana

Abrí PowerShell en la raíz del repositorio. El primer bloque entra a `modulo8/`; luego ejecutá **un escenario por vez**. Mirá en Grafana el mismo intervalo horario en que corriste cada comando. Estas pruebas usan el Compose local y servicios simulados: todavía no acreditan M1, M2, M3, M6, M7 ni PUSH reales.

## Preparación

```powershell
cd .\modulo8
pnpm run ensure:stack
docker compose --env-file .env --profile observability up -d alloy
docker compose --env-file .env ps
Invoke-RestMethod http://localhost:8000/health/ready
```

Si cambiaste código, reconstruí antes de medir: `docker compose --env-file .env up -d --build m8-app`. Usá una base local de pruebas: varios escenarios crean datos. No subas `.env` ni muestres credenciales en capturas. Los informes JSON locales quedan en `tests/stress/results/`, ignorados por Git.

En Grafana elegí **Last 1 hour** y **All** en el filtro de requerimientos. Los paneles inferiores muestran actividad de los últimos cinco minutos; las tarjetas HTTP superiores miran 24 horas y las asíncronas leen registros propios persistidos de M8. Si aparece cero, comprobá el intervalo, que Alloy esté levantado y que tengas importado el JSON actualizado.

## Recorridos pequeños por requerimiento

### RF8.1 — Notificación lógica

```powershell
pnpm run scenario:m3
```

Publica un evento **M3 simulado**, repite su `messageId`, manda uno inválido y luego otro válido. Esperá una notificación y una solicitud de entrega por evento válido, sin duplicado. Mirá la tarjeta RF8.1; este flujo no se demuestra con un endpoint HTTP.

### RF8.2 — QR

```powershell
pnpm run smoke:qr
```

Esperá creación `201`, validación `200`, repetición de la misma operación `200` y otra operación sobre el QR usado `409`: son **cuatro peticiones HTTP**. Mirá `/qr` y `/qr/validate`. La tarjeta RF8.2 cuenta peticiones, mientras que el panel de operaciones separa **Emitido: 1, Válido: 2 y Conflicto: 1**. Esperá al menos 20 segundos para que Alloy tome y envíe una muestra, actualizá Grafana y mantené el rango que incluye la ejecución. Redis guarda el QR; M8 no cambia el estado del viaje.

### RF8.3 — Comprobante

```powershell
pnpm run smoke:receipts
```

Esperá emisión `201` y descarga PDF `200`. Mirá `POST /api/v1/receipts` y `GET /api/v1/receipts/:tripId/pdf`. El comando también ejercita RF8.4.

### RF8.4 — Reenvío

```powershell
pnpm run smoke:receipts
```

Esperá referencia temporal `200` y **POST de reenvío `202`**. En Grafana distinguí `GET /internal/receipts/:tripId/delivery-reference` de `POST /api/v1/receipts/:tripId/resend`. El reenvío usa el PDF ya emitido; Redis interviene en el enlace, el límite y el bloqueo concurrente.

### RF8.5 — Soporte

```powershell
pnpm run smoke:support
```

Esperá ticket `201`; mirá `POST /tickets` y el estado de PostgreSQL.

### RF8.6 — RabbitMQ e Inbox

```powershell
pnpm run scenario:m3
```

El informe debe mostrar Inbox procesado, duplicado sin efecto, evento inválido en DLQ y siguiente evento válido procesado. Mirá la tarjeta RF8.6. Sus datos salen del Inbox **de M8**, no de la base M3.

### RF8.7 — Tokens e intento de entrega

```powershell
pnpm run smoke:delivery
pnpm run scenario:m3
```

El primero prueba alta, consulta y baja de token. El segundo comprueba un intento **sandbox** por notificación válida. Mirá `/devices/tokens` y los intentos RF8.7. No prueba un PUSH recibido en un teléfono real.

## Carga por requerimiento

Corré uno por vez y anotá peticiones, errores y p95 de k6:

```powershell
pnpm run load:qr
pnpm run load:receipts
pnpm run load:resend
pnpm run load:support
pnpm run load:delivery
```

`load:qr` genera y valida QR. `load:receipts` descarga un PDF preparado. **`load:resend` sólo consulta referencias: no carga el POST de reenvío.** `load:support` lista tickets y `load:delivery` lista tokens. Son rutas concretas, no todas las operaciones de cada RF.

Para encontrar el primer nivel que se degrada en cada recorrido:

```powershell
node tests/stress/run-capacity.mjs qr 5
node tests/stress/run-capacity.mjs receipts 5
node tests/stress/run-capacity.mjs resend 5
node tests/stress/run-capacity.mjs support 5
node tests/stress/run-capacity.mjs delivery 5
```

Cada corrida sube por 50, 100, 200, 400 y 600 usuarios virtuales (VU), cinco segundos por nivel. Se detiene si aparece un error HTTP, `/health/ready` deja de estar `ok` o el p95 llega a **1000 ms**. Un p95 alto indica degradación, no necesariamente caída. Ese segundo es un umbral local de prueba, no una consigna oficial. VU tampoco equivale a usuarios reales del sistema conjunto.

### Encontrar el límite práctico del QR

El script acepta niveles personalizados de hasta 1200 VU. En PowerShell, desde `modulo8/`, ejecutá:

```powershell
$env:CAPACITY_LEVELS='600,625,650,700'
node tests/stress/run-capacity.mjs qr 30
Remove-Item Env:CAPACITY_LEVELS
```

Se detiene en el primer nivel que supere el p95 de 1000 ms, tenga errores HTTP o deje `/health/ready` distinto de `ok`. Para comprobar niveles posteriores, ejecutalos por separado con `CAPACITY_LEVELS` igual al nivel elegido. Los informes quedan en `tests/stress/results/`.

En este equipo, el 17/11/2026, con el Compose local y 30 segundos por nivel, **600 VU** dieron 30.890 peticiones, p95 **632 ms** y cero errores; **625 VU** dieron 29.784 peticiones, p95 **1033 ms** y cero errores; **650 VU** dieron 30.830 peticiones, p95 **1122 ms** y cero errores; **700 VU** dieron 31.510 peticiones, p95 **1065 ms** y cero errores. El primer incumplimiento del objetivo local de 1 segundo quedó entre **600 y 625 VU**. La tasa se mantuvo cerca de 1000 peticiones/s y M8 siguió disponible. En una muestra durante 1200 VU, M8 usó aproximadamente 118 % de un núcleo y k6 24 %; esto apunta al proceso de M8 como límite más probable de esta carga, sin descartar otros recursos. A 1200 VU tampoco hubo errores HTTP, por lo que **no se observó una caída del proceso**. Estos resultados corresponden al flujo QR local, no a una capacidad garantizada del sistema completo; la latencia varía entre corridas y con la duración.

### Medir el POST de reenvío que aparece lento en Grafana

```powershell
node tests/stress/run-k6.mjs receipts 10 10
node tests/stress/run-k6.mjs receipts 100 100
```

Cada recorrido emite un comprobante y pide un reenvío. Es una medición del **flujo completo**, no del POST aislado: también intervienen el sandbox fiscal y otras rutas. En Grafana filtrá `POST /api/v1/receipts/:tripId/resend`, compará su p95 con 10 y 100 VU, y anotá cuántos `202`, `409`, `429` y `5xx` hubo. No atribuyas la demora a Redis o PostgreSQL únicamente por la gráfica.

Si el panel no permite separar los resultados, abrí **Explore** en Grafana y pegá estas consultas durante la prueba. La primera cuenta las respuestas del POST por código en cinco minutos; la segunda estima su p95 en milisegundos:

```promql
sum by (status_code) (increase(http_requests_total{service="m8-app",method="POST",route="/api/v1/receipts/:tripId/resend"}[5m]))
histogram_quantile(0.95, sum by (le) (rate(http_request_duration_seconds_bucket{service="m8-app",method="POST",route="/api/v1/receipts/:tripId/resend"}[5m]))) * 1000
```

## M8 completo: rampa de 45 segundos

En una terminal iniciá la mezcla HTTP. Sube hasta 600 VU y mantiene ese nivel cinco segundos:

```powershell
pnpm run load:ramp45
```

Mientras corre, en **otra terminal** dentro de `modulo8/`, publicá 600 eventos M3 simulados:

```powershell
node tests/stress/run-m3-batch.mjs 600
```

El informe AMQP debe mostrar 600 Inbox, 600 notificaciones y 600 intentos sandbox, sin efectos extra al repetir diez `messageId`. Compará los RF, peticiones, errores y p95 de k6 con el tráfico y las latencias del mismo período en Grafana. Después comprobá:

```powershell
Invoke-RestMethod http://localhost:8000/health/ready
docker compose --env-file .env ps
```

Esta rampa mezcla QR, descarga PDF, referencia de reenvío, listado de tickets y tokens. **No carga masivamente el POST de reenvío ni todas las escrituras.** Para 600 recorridos HTTP que sí escriben en varios RF, corré aparte:

```powershell
pnpm run load:fullflow600
```

El último comando lanza una **ráfaga**, no una rampa. Cada recorrido genera y valida QR, emite y descarga comprobante, pide referencia y reenvío, crea ticket y registra/lista/desactiva token. No compares su p95 con el de la rampa como si midieran la misma carga.

## Errores y caídas controladas

```powershell
pnpm run scenario:errors
```

Provoca `400`, `401`, `404`, `409`, `422` y `503` en rutas reales y restaura el sandbox fiscal al terminar. Mirá los códigos HTTP en Grafana. Una URL inventada se agrupa como `M8-CORE`.

Un solo error casi no se distingue en **Peticiones HTTP por segundo y ruta**: el panel dibuja una tasa, no una lista de respuestas. Para comprobar el conteo por código, elegí en Grafana un rango que incluya la prueba y pegá en **Explore**:

```promql
sum by (status_code) (increase(http_requests_total{service="m8-app",rf=~"RF8.2|RF8.3"}[5m]))
```

La tarjeta **Errores HTTP 5xx (últimos 5 min)** debe mostrar el `503` mientras esté dentro de esa ventana. Las series de estos errores se inicializan en cero al arrancar M8 para que Grafana pueda contar también el primer fallo después de un reinicio.

```powershell
pnpm run test:resiliencia
Invoke-RestMethod http://localhost:8000/health/ready
```

La batería detiene o degrada Redis, RabbitMQ, fiscal y PostgreSQL **en el Compose local**, comprueba recuperación y vuelve a revisar salud. No la corras en la rama o infraestructura compartida.

Para mostrar caída y recuperación de la app, mantené Alloy levantado y detené sólo `m8-app` durante al menos 25 segundos:

```powershell
docker compose --env-file .env stop m8-app
Start-Sleep -Seconds 25
docker compose --env-file .env start m8-app
Invoke-RestMethod http://localhost:8000/health/ready
```

En Grafana mirá **Historial de disponibilidad de M8** con un rango que incluya la interrupción: `up=0` significa que Alloy no pudo leer `/metrics`; `up=1`, que pudo otra vez. `up` no equivale a `/health/ready`. M8 es una única app: al detenerla, ningún RF atiende HTTP. La batería anterior demuestra qué ocurre cuando cae una dependencia y la app sigue viva.

## Cómo interpretar y presentar la evidencia

En una corrida local, la rampa de 45 segundos hizo **52 363 peticiones**, cero fallos y p95 global **508 ms**; en paralelo se procesaron 600 eventos simulados sin duplicados. Otra prueba de 600 recorridos completos hizo **8400 peticiones** sin respuestas inesperadas, pero su p95 subió a **2350 ms**: hubo degradación de latencia, no caída del proceso. En la carga aislada de QR, 600 VU dieron p95 **1258 ms**, frente a **516 ms** con 400 VU. Son resultados de este equipo y de los sandboxes locales.

El p95 cercano a **4 s** que muestra la captura para `POST /api/v1/receipts/:tripId/resend` **es alto**. La captura no revela por sí sola cuántos POST hubo, qué códigos devolvieron ni si coincidió con la ráfaga. Además, Grafana estima p95 desde intervalos del histograma, no mide la duración exacta de una petición individual. Repetí la prueba de 10 y 100 VU de arriba: si ya ronda 4 s con poca carga, investigá el recorrido del POST; si sólo crece en la ráfaga, documentá ese límite de capacidad.

Las operaciones de negocio no equivalen a peticiones HTTP ni a muestras de Alloy. Las tarjetas superiores y los paneles de cinco minutos pueden mostrar números diferentes por su ventana temporal. Para cada escenario guardá fecha/hora, comando, equipo, VU, duración, peticiones, errores por código, p95, `/health/ready` y una captura de Grafana en el mismo rango. Para RabbitMQ agregá Inbox, duplicados, DLQ e intentos sandbox. El JSON local `infra/observability/grafana-dashboard-m8.json` **no actualiza Grafana Cloud** hasta volver a importarlo.
