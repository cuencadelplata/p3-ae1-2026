# Observabilidad y pruebas HTTP de M8

M8 expone métricas Prometheus en `GET /metrics`. Grafana Alloy puede leerlas y enviarlas a Grafana Cloud. El smoke de k6 ejecuta una sola iteración con un usuario virtual; sirve para comprobar rutas y visualizar métricas, **no mide capacidad ni 600 usuarios**.

La [matriz de escenarios](matriz-escenarios-observabilidad.md) indica qué ejecutar
por RF, cómo provocar fallas controladas y qué resultados se obtuvieron con 600
usuarios virtuales en el Compose local.

El recorrido es: **k6 local → API de M8 → `/metrics` → Alloy → Grafana Cloud**. k6 ya corre localmente en Docker y no necesita iniciar sesión en Grafana. Para ver las métricas internas en la nube se usa una cuenta de Grafana Cloud del equipo y un token de escritura para métricas. Subir los resultados propios de k6 a Grafana Cloud k6 es una opción distinta y todavía no está configurada en estos scripts.

## Preparación local

Desde `modulo-8/`, crear `.env` a partir de `.env.example` y reemplazar todos los valores `replace-with-*` con credenciales privadas. Usar las mismas credenciales de RabbitMQ en sus dos URL. Mantener `.env` fuera de Git. Levantar M8 y sus dependencias:

```powershell
pnpm install --frozen-lockfile
pnpm run ensure:stack
docker compose --env-file .env ps
Invoke-RestMethod http://localhost:3000/health/ready
Invoke-WebRequest http://localhost:3000/metrics
```

Si se cambió código de M8, reconstruir la imagen con `docker compose --env-file .env up -d --build m8-app` antes de probar.

## Smoke con k6

Los comandos usan la imagen Docker `grafana/k6:2.4.0`; no hace falta instalar k6 en Windows. Fallan si una comprobación HTTP falla.

| Comando | Comprueba |
| --- | --- |
| `pnpm run smoke:http` | QR, comprobante, soporte, tokens, salud y métricas |
| `pnpm run smoke:qr` | Generación, validación idempotente y bloqueo de otro uso |
| `pnpm run smoke:receipts` | Emisión, PDF, referencia y solicitud de reenvío |
| `pnpm run smoke:support` | Apertura de ticket |
| `pnpm run smoke:delivery` | Alta, lista y baja de token de dispositivo |

RF8.1 y RF8.6 usan RabbitMQ, por lo que estos comandos HTTP no prueban su procesamiento. Para ellos ejecutar la batería E2E de M8 y revisar Inbox, notificación y DLQ. `smoke:delivery` verifica el registro de dispositivos, no afirma que se haya enviado un PUSH.

## Grafana Cloud

Para enviar métricas, obtener de la cuenta de Grafana Cloud del equipo la URL **Prometheus remote write**, el ID numérico de la instancia de métricas y un **Cloud Access Policy token con `metrics:write`**. Colocarlos en el `.env` privado como `GRAFANA_CLOUD_REMOTE_WRITE_URL`, `GRAFANA_CLOUD_USER` y `GRAFANA_CLOUD_TOKEN`, respectivamente. No publicarlos en Git ni en capturas. El contenedor Alloy es opcional y sólo se inicia al pedir el perfil. [Grafana documenta estos tres datos](https://grafana.com/docs/grafana-cloud/send-data/metrics/metrics-prometheus/).

```powershell
docker compose --env-file .env --profile observability up -d alloy
docker compose --env-file .env logs --tail=50 alloy
```

En Grafana Cloud, abrir **Explore** y consultar `http_requests_total{service="m8-app"}` para comprobar que llegan series recientes. Se puede graficar la tasa con `sum by (rf) (rate(http_requests_total{service="m8-app"}[5m]))`. Las métricas HTTP sólo representan rutas HTTP; RF8.1 y RF8.6 requieren sus propias pruebas RabbitMQ. Ver un gráfico en Grafana requiere que Alloy pueda conectar con la nube; el smoke local por sí solo no prueba esa conexión.

Para detener sólo el envío a Grafana: `docker compose --env-file .env --profile observability stop alloy`.

## Tablero verificable

El archivo [`infra/observability/grafana-dashboard-m8.json`](../infra/observability/grafana-dashboard-m8.json)
contiene consultas para las métricas que M8 emite hoy. Desde Grafana Cloud:
**Dashboards → New → Import dashboard → Upload dashboard JSON file**, elegir el
archivo y seleccionar la fuente de métricas del equipo. Para compararlo con el
tablero compartido, asignar un UID nuevo al importar y guardarlo como copia.
Revisar **Last 15 minutes**
después de ejecutar el smoke o una prueba de carga. El archivo modifica una copia
local del tablero: no actualiza automáticamente el tablero ya guardado en la nube.

El resumen superior muestra **una tarjeta por cada RF8.1–RF8.7**. RF8.1,
RF8.6 y los intentos de RF8.7 proceden de conteos persistidos en tablas
propias de M8; RF8.2–RF8.5 proceden de peticiones HTTP. Otra tarjeta muestra
la API de tokens de RF8.7. También se muestran disponibilidad de `/metrics`,
memoria y CPU del proceso Node y tamaño de la base de M8. La cuarta sección
detalla los tres conteos asíncronos. El tablero no interpreta
`POST /notifications` como entrega real, ni inventa un endpoint HTTP para
RF8.6. Los conteos de intentos no demuestran PUSH real; tampoco reemplazan
las métricas internas del broker RabbitMQ ni la inspección de la DLQ.

Las tarjetas HTTP **del resumen superior** estiman peticiones de las ultimas
24 horas a partir de las muestras enviadas a Grafana Cloud, incluso si se
reinicia M8. Las tarjetas asincronas superiores leen totales persistidos de M8.
Los paneles de actividad y errores de las secciones
inferiores muestran **los últimos cinco minutos**. El tablero
compartido antiguo conserva consultas y umbrales distintos. Este JSON tiene
UID nuevo para importarlo como copia, sin sobrescribir el tablero del grupo.
Si ya se importó una versión anterior de la copia, hay que **volver a importar
el archivo actualizado**: editar un JSON local no cambia el tablero de la nube.
Las diferencias entre muestras de conteos persistidos en la cuarta sección son
enteras; el panel de operaciones recientes redondea la estimación de Prometheus
para evitar fracciones visuales.
El tablero abre con rango de **una hora** y muestra un historial `up` de M8:
`1` significa que Alloy pudo consultar `/metrics`, `0` que no pudo. Alloy
consulta cada 10 segundos, por lo que una interrupcion menor puede no aparecer.
Ese historial no equivale a `/health/ready`; M8 puede estar vivo y degradado.

## Pruebas de carga local con k6

Primero levantar `m8-app` con `pnpm run ensure:stack`. Estos escenarios usan
una subida gradual, un tramo estable y una bajada. Por defecto alcanzan **5 VU**
durante **10 segundos** de subida y **10 segundos** estables; comparan checks
`>99 %`, errores HTTP `<1 %` y latencia p95 `<1000 ms`. Son umbrales iniciales
para la demostración local, no una meta oficial de la cátedra.

| Comando | Qué mide | Efecto en datos |
| --- | --- | --- |
| `pnpm run load:support` | Listado de tickets RF8.5 y PostgreSQL | Sólo lectura |
| `pnpm run load:qr` | Generación y consumo QR RF8.2 | Crea QR únicos de prueba |
| `pnpm run load:receipts` | Descarga PDF RF8.3 | Crea un comprobante antes de leerlo; usa identidad sandbox |
| `pnpm run load:delivery` | Consulta autenticada de tokens RF8.7 | Sólo lectura; usa JWT local de prueba |
| `pnpm run load:resend` | Referencia temporal RF8.4 | Crea un comprobante y referencias de prueba |
| `pnpm run load:mixed` | QR, PDF, reenvío, soporte y tokens juntos | Crea QR y un comprobante de prueba |
| `pnpm run load:capacity` | Escalones hasta 600 VU en solo lectura | Guarda informe y detiene al primer fallo |
| `pnpm run load:ramp45` | Rampa de 45 s hasta 600 VU, con 5 s al máximo y p95 por RF | Mezcla los cinco recorridos HTTP anteriores |
| `pnpm run load:fullflow600` | 600 recorridos completos en paralelo: QR, comprobante, reenvío, ticket y token | Escribe 600 veces en varios RF; usar sólo en la base local de prueba |
| `pnpm run load:m3` | Eventos M3 simulados por RabbitMQ | Crea notificaciones e intentos PUSH sandbox |

k6 se conecta a `m8-app:3000` por la red interna de Compose. Usar
`node tests/stress/run-capacity.mjs qr 5` y los otros modos documentados en la
[matriz](matriz-escenarios-observabilidad.md) para encontrar el primer nivel
que supere 1 s de p95 o tenga errores. RF8.1 y RF8.6 se prueban con eventos
RabbitMQ y se ven en los conteos asíncronos del tablero actualizado.
`load:fullflow600` es una ráfaga de 600 VU y 600 iteraciones, no una rampa de
45 s. Puede ejecutarse a la vez que `node tests/stress/run-m3-batch.mjs 600`.
Cada operación QR usa una clave de idempotencia distinta por usuario y
recorrido. El p95 de esta ráfaga puede superar el de la rampa gradual.

### Ejecución local de referencia (16/11/2026)

Con 5 VU máximos y 25 segundos por escenario, en un único equipo con los
servicios sandbox de M8, se obtuvo:

| Escenario | Peticiones HTTP | Errores | p95 HTTP |
| --- | ---: | ---: | ---: |
| Soporte | 445 | 0 % | 3,61 ms |
| QR | 858 | 0 % | 10,76 ms |
| Comprobantes | 441 | 0 % | 5,10 ms |
| Tokens | 445 | 0 % | 3,21 ms |

Alloy registró 2515 muestras enviadas, 0 fallidas y 0 pendientes al terminar.
Las cuatro pruebas de la tabla suman 2189 peticiones HTTP; 2515 no es una cifra
de operaciones de M8. Estos valores son una referencia de este equipo y no demuestran capacidad para
600 usuarios ni el comportamiento de M8 con servicios reales.

El resumen de cada ejecución queda en `tests/stress/results/`, ignorado por Git.
Guardar también el comando, VU, duración, p95, tasa de errores, equipo utilizado
y una captura de Grafana con el mismo rango horario. Para variar la carga en
PowerShell, por ejemplo:

```powershell
$env:LOAD_VUS = '20'
$env:LOAD_DURATION_SECONDS = '30'
pnpm run load:support
Remove-Item Env:LOAD_VUS, Env:LOAD_DURATION_SECONDS
```

No ejecutar 600 VU contra el entorno compartido sin un escenario y criterios
acordados. RF8.1 y RF8.6 se miden localmente con `load:m3` y `scenario:m3`,
que comprueban Inbox, duplicados, DLQ y entrega sandbox; los escenarios HTTP
anteriores no representan esos flujos. Las pruebas
con servicios M1/M2/M3/M6/M7 y un PUSH real quedan para la rama integrada.
