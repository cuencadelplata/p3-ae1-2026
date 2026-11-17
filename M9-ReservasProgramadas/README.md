# M9 — Reservas Programadas

Microservicio del proyecto de movilidad urbana de Paradigmas y Lenguajes de Programación III. Permite crear, consultar, modificar y cancelar reservas futuras, y activar su despacho al llegar el horario programado.

La implementación utiliza **Node.js, TypeScript, Express, Prisma, PostgreSQL, Redis y RabbitMQ**. Incluye una interfaz web, Swagger, pruebas automatizadas, instrumentación OpenTelemetry y escenarios de rendimiento con Grafana k6.

## Inicio rápido

Requisitos: **Node.js 22.15.0 o posterior compatible**, npm y **Docker Desktop con Docker Compose 2.24 o superior**. En Windows, usar contenedores Linux y ejecutar los ejemplos en PowerShell.

Desde la raíz del repositorio:

```powershell
cd M9-ReservasProgramadas
npm ci
npm run db:generate
npm run local:up
```

**Para esta ejecución local no hace falta crear un `.env` ni configurar tokens de Grafana.** Compose incluye los valores del entorno de demostración. La primera ejecución descarga imágenes, instala dependencias de la imagen y compila el módulo; puede demorar varios minutos.

Comprobar el arranque:

```powershell
docker compose ps
Invoke-RestMethod http://localhost:3000/health
Invoke-RestMethod http://localhost:3000/readiness
```

Resultado esperado: `ok` en health; `ready` y PostgreSQL, Redis y RabbitMQ en `up` en readiness. Si RabbitMQ todavía está iniciando, esperar y repetir.

Abrir la aplicación y el contrato interactivo:

```powershell
Start-Process 'http://localhost:3000'
Start-Process 'http://localhost:3000/docs/'
```

Para comenzar las pruebas:

```powershell
npm test
npm run k6:smoke
npm run k6:activation
```

Los comandos de este README se ejecutan **dentro de `M9-ReservasProgramadas`**, salvo indicación expresa. Su `package.json` y `package-lock.json` contienen los comandos y las dependencias del módulo; la raíz del repositorio no contiene un paquete npm de M9.

Si se prefiere trabajar desde la raíz, indicar el módulo en cada comando:

```powershell
npm --prefix M9-ReservasProgramadas ci
npm --prefix M9-ReservasProgramadas run local:up
npm --prefix M9-ReservasProgramadas test
npm --prefix M9-ReservasProgramadas run k6:smoke
```

Usar el mismo prefijo para los demás comandos npm. Esto mantiene la instalación y ejecución dentro de M9 sin utilizar los paquetes de otros módulos. Las credenciales Cloud se configuran en `M9-ReservasProgramadas/observability/.env.grafana-cloud`.

## Funcionalidades y reglas

- Crear una reserva con cliente, origen, destino, vehículo y horario futuro.
- Consultar una reserva individual o un listado paginado.
- Modificar reservas en estado `PROGRAMADA`.
- Cancelar lógicamente una reserva; el registro permanece en PostgreSQL.
- Activar automáticamente las reservas vencidas y solicitar el despacho a M5.
- Estimar la tarifa mediante M7. Una falla de ruta o tarifa puede degradar la operación y permitir guardar la reserva sin estimación.
- Coordinar modificaciones y activaciones con locks Redis y transiciones condicionales en PostgreSQL.
- Publicar eventos mediante Outbox y procesar resultados mediante Inbox, con detección de eventos duplicados.

La cancelación se admite en `PROGRAMADA` o `ACTIVANDO`, según el progreso del despacho. Si la reserva está siendo enviada y todavía no tiene una solicitud M5 confirmada, puede responder `409 RESERVA_EN_PROCESO`. Cuando existe una solicitud, se intenta cancelarla en M5 antes de confirmar la cancelación local.

### Estados

| Estado       | Significado                                                                   |
| ------------ | ----------------------------------------------------------------------------- |
| `PROGRAMADA` | Reserva futura pendiente de activación                                        |
| `ACTIVANDO`  | Despacho iniciado y resultado pendiente                                       |
| `ACTIVADA`   | M5 confirmó la asignación de conductor                                        |
| `CANCELADA`  | Cancelación lógica confirmada                                                 |
| `FALLIDA`    | La activación no pudo completarse por un resultado de negocio o falta de ruta |

La creación no asigna un chofer. La selección de candidatos, las ofertas y la asignación pertenecen a M5; M7 calcula la tarifa. Las funcionalidades QR/PDF de M8 quedan fuera de M9.

## Arquitectura y procesamiento

```text
Cliente / interfaz / k6
          |
       Express
          |
   Servicios de M9 ----- REST -----> M7: tarifa
      |       |
      |       +---- Redis: caché y locks
      |
      +---- Prisma / PostgreSQL: reservas, Outbox e Inbox
                         |
                  Outbox worker
                         |
                      RabbitMQ
                         |
                    M5: despacho
                         |
                 Resultado por evento
                         |
                 Inbox / estado final
```

El scheduler busca reservas vencidas. La transición `PROGRAMADA → ACTIVANDO` y el evento `reservation.ready-for-dispatch.v1` se persisten en una misma transacción. El worker publica los pendientes con confirmación del broker. M5 responde con `ride-request.assigned.v1` o `ride-request.failed.v1`; M9 registra el Inbox y el estado final en una transacción.

Las entregas repetidas pueden ocurrir: el Inbox evita repetir el efecto de un `eventId` procesado. Los fallos de publicación/consumo utilizan reintentos y DLQ. La idempotencia del despacho no implica que `POST /reservas` sea idempotente; no reintentar creaciones indiscriminadamente.

Compose levanta **stubs locales de M5 y M7**, junto con M9, PostgreSQL, Redis y RabbitMQ. El stub M5 automatiza una demostración de rechazo del primer candidato y aceptación del siguiente. Es un doble de pruebas; el contrato de integración real debe acordarse con el módulo correspondiente.

En Compose, el scheduler y el polling Outbox utilizan intervalos de 5 segundos por defecto. Fuera de Compose, el cron predeterminado del código es de 30 segundos.

## Accesos y puertos

| Recurso                          | Dirección predeterminada             |
| -------------------------------- | ------------------------------------ |
| Interfaz M9                      | <http://localhost:3000>              |
| API de reservas                  | <http://localhost:3000/reservas>     |
| Swagger UI                       | <http://localhost:3000/docs/>        |
| OpenAPI JSON                     | <http://localhost:3000/openapi.json> |
| Liveness                         | <http://localhost:3000/health>       |
| Readiness                        | <http://localhost:3000/readiness>    |
| Stub M5                          | <http://localhost:3001>              |
| RabbitMQ Management              | <http://localhost:15672>             |
| Alloy, con observabilidad activa | <http://localhost:12345>             |

PostgreSQL utiliza el puerto 5432, Redis el 6379 y AMQP el 5672. El stub M7 está disponible internamente en `http://m7-stub:3002`, sin publicar ese puerto al host. Las credenciales predeterminadas de PostgreSQL y RabbitMQ son `m9` / `m9-local`, exclusivamente para la demostración local.

## API

| Método   | Ruta                           | Resultado principal            |
| -------- | ------------------------------ | ------------------------------ |
| `POST`   | `/reservas`                    | Crear; HTTP 201                |
| `GET`    | `/reservas?page=1&pageSize=20` | Listado; HTTP 200              |
| `GET`    | `/reservas/:id`                | Consultar; HTTP 200            |
| `PATCH`  | `/reservas/:id`                | Modificar; HTTP 200            |
| `DELETE` | `/reservas/:id`                | Cancelar lógicamente; HTTP 200 |

El listado devuelve `{ reservas, page, pageSize }`. Por defecto utiliza página 1 y tamaño 20; el máximo permitido por página es 100.

La creación requiere `clienteId` UUID, origen y destino diferentes, `vehiculo` con valor `AUTO` o `MOTO`, y `fechaHoraProgramada` ISO 8601 con zona horaria y fecha futura. No permite propiedades adicionales. PATCH admite los campos modificables de la reserva y requiere al menos uno.

### Ejemplo CRUD en PowerShell

```powershell
$body = @{
    clienteId = '20000000-0000-4000-8000-000000000001'
    origen = 'Terminal de Omnibus'
    destino = 'Aeropuerto'
    vehiculo = 'AUTO'
    fechaHoraProgramada = (Get-Date).AddDays(2).ToUniversalTime().ToString('o')
} | ConvertTo-Json

$reserva = Invoke-RestMethod -Method Post `
    -Uri 'http://localhost:3000/reservas' `
    -ContentType 'application/json' -Body $body

Invoke-RestMethod "http://localhost:3000/reservas/$($reserva.id)"
Invoke-RestMethod 'http://localhost:3000/reservas?page=1&pageSize=20'

$cambios = @{ destino = 'Puerto'; vehiculo = 'MOTO' } | ConvertTo-Json
Invoke-RestMethod -Method Patch `
    -Uri "http://localhost:3000/reservas/$($reserva.id)" `
    -ContentType 'application/json' -Body $cambios

Invoke-RestMethod -Method Delete `
    -Uri "http://localhost:3000/reservas/$($reserva.id)"
```

La cancelación devuelve la reserva con estado `CANCELADA`; no elimina físicamente el registro. Para comprobar la activación al horario, utilizar `npm run k6:activation`.

### Errores y salud

Los errores de API utilizan `{ error: { codigo, mensaje } }`. Entre los estados habituales están 400 por datos inválidos, 404 por reserva inexistente, 409 por conflicto de estado/lock y 503 por coordinación o base de datos no disponible. Los errores inesperados se traducen a 500.

`/health` informa que el proceso responde. `/readiness` comprueba PostgreSQL, Redis y RabbitMQ y devuelve 503 si una dependencia no está disponible. Una falla de M7 puede permitir un 201 sin tarifa; por eso deben revisarse también las métricas de degradación. Redis caído permite degradar lecturas de caché a PostgreSQL, mientras las operaciones que requieren lock pueden rechazarse.

## Configuración y desarrollo

El archivo `.env.example` contiene las variables disponibles. Para personalizar el entorno puede copiarse una vez a `.env`, pero **Compose funciona con sus valores predeterminados sin esa copia**.

Variables principales:

| Variable                                       | Función                                                              |
| ---------------------------------------------- | -------------------------------------------------------------------- |
| `PORT`                                         | Puerto de M9                                                         |
| `DATABASE_URL`, `REDIS_URL`, `RABBITMQ_URL`    | Conexiones de la aplicación                                          |
| `M5_BASE_URL`, `M7_BASE_URL`                   | Dependencias REST                                                    |
| `M5_SERVICE_TOKEN`                             | Autenticación de servicio hacia M5                                   |
| `DISPATCH_MODE`                                | `events` por defecto; `rest` como alternativa de compatibilidad      |
| `ROUTE_RESOLVER_MODE`                          | `stub` para demostración; `blocked` hasta contar con resolución real |
| `RESERVATION_JOB_INTERVAL`                     | Expresión cron del scheduler                                         |
| `OUTBOX_POLL_INTERVAL_MS`                      | Intervalo del worker                                                 |
| `REDIS_CACHE_TTL_SECONDS`, `REDIS_LOCK_TTL_MS` | Duración de caché y locks                                            |
| `OTEL_ENABLED`                                 | Activación de exportadores OpenTelemetry                             |

Las URLs de variables son las vistas **desde el proceso**: dentro de Docker se utilizan nombres de servicio; un proceso ejecutado en Windows utiliza los puertos publicados en localhost.

Para ejecutar M9 con recarga en el host y mantener las dependencias en Docker:

```powershell
docker compose up -d postgres redis rabbitmq m5-stub m7-stub
```

M7 no publica un puerto al host y sus URLs internas no son accesibles desde Windows. Por eso el camino recomendado para probar el flujo completo es `npm run local:up`; para desarrollo en el host se deben proporcionar endpoints M5/M7 accesibles y las conexiones correctas. Tras configurarlos:

```powershell
npm run db:generate
npm run db:migrate:deploy
npm run dev
```

`npm run build` compila TypeScript en `dist/`; `npm start` ejecuta esa compilación. La imagen Docker aplica las migraciones antes de iniciar M9. `npm run db:seed` carga datos ficticios y debe ejecutarse únicamente sobre la base de desarrollo deseada.

Para instalar las versiones verificadas, utilizar `npm ci`. Prisma CLI, Prisma Client y su instrumentación están alineados en **6.19.3**; actualizar los tres juntos después de comprobar la compatibilidad del esquema. Instalar `@prisma/client@latest` por separado puede introducir una versión mayor incompatible con este módulo.

La dependencia de desarrollo `magicast@0.3.5` satisface el peer opcional de la configuración de Prisma y permite compartir el lock entre npm 10 (Docker) y npm 11. El override de `deepmerge-ts` se limita a `@prisma/config` para corregir su alerta de seguridad. Las autorizaciones `allowScripts` fijan las versiones revisadas de Prisma y esbuild; Scarf queda denegado en npm que admite esta configuración.

## Pruebas automatizadas

```powershell
npm run typecheck
npm run lint
npm run build
npm test
npm run test:coverage
```

| Comando                       | Alcance                                                                                                    |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `npm test`                    | Suites unitarias e integración local; no requiere tokens Cloud                                             |
| `npm run test:coverage`       | Cobertura en `coverage/`                                                                                   |
| `npm run test:infrastructure` | PostgreSQL, Redis y RabbitMQ en proyecto de prueba aislado; persistencia, locks, Outbox/Inbox y mensajería |
| `npm run test:e2e`            | Compose completo y pruebas HTTP/eventos                                                                    |
| `npm run verify`              | Tipos → lint → formato → tests; se detiene en el primer fallo                                              |
| `npm run format:check`        | Comprueba formato sin modificar archivos                                                                   |

Las suites de infraestructura y E2E necesitan Docker. **El runner E2E detiene la composición del proyecto antes de iniciarla y al terminar**; ejecutarlo cuando se pueda interrumpir la demostración. Después, levantar nuevamente con `local:up` u `obs:up` según corresponda.

La última revisión guardada aprobó 85/85 pruebas normales. `verify` seguía fallando en formato en el checkout Windows; revisar finales de línea y archivos generados, sin interpretar ese resultado como una aprobación completa del comando general. Los resultados históricos no reemplazan ejecutar las verificaciones sobre nuevos cambios.

## Pruebas de rendimiento con k6

Con M9 y sus dependencias iniciados:

```powershell
npm run k6:smoke
npm run k6:activation
```

El runner utiliza la imagen `grafana/k6:2.3.0` en la red Compose. **Las pruebas locales no requieren tokens ni instalar k6 en el host.**

| Comando          | Escenario                                                              |
| ---------------- | ---------------------------------------------------------------------- |
| `k6:smoke`       | CRUD completo, 2 VUs durante 30 s por defecto                          |
| `k6:load`        | Mezcla de lecturas/escrituras, 10 VUs durante 3 min                    |
| `k6:stress`      | Incremento de VUs, sostenimiento y descenso                            |
| `k6:spike`       | Pico de concurrencia y recuperación                                    |
| `k6:cache`       | Comparación de lecturas en frío/caliente tras esperar el TTL           |
| `k6:concurrency` | Modificación/cancelación de reservas compartidas; conflictos esperados |
| `k6:activation`  | Reservas próximas y espera acotada hasta el resultado final            |

Todos se ejecutan como `npm run <comando>`. Los JSON de resultados y sus metadatos se guardan en `performance/results/`, incluidos los ensayos fallidos. Código 0 significa que los umbrales evaluados aprobaron; 99 significa incumplimiento de thresholds.

Ejemplo de estrés corto y configurable:

```powershell
$env:PROFILE = 'short'
$env:DURATION = '10s'
$env:STRESS_STEPS = '2,5,10'
try {
    npm run k6:stress
} finally {
    Remove-Item Env:PROFILE, Env:DURATION, Env:STRESS_STEPS -ErrorAction SilentlyContinue
}
```

Los umbrales son referencias iniciales, no SLA aprobados. El escenario stress actual ejecuta creación y lecturas; no acredita modificación/cancelación por mostrar umbrales sin muestras de esas operaciones. Una prueba corta tampoco determina la capacidad máxima.

Si se personalizó la red o el puerto de M9, ajustar `K6_DOCKER_NETWORK` y `BASE_URL`. Desde el contenedor, `localhost` es el propio k6; normalmente se utiliza `http://m9-reservas:3000`. La alternativa `node scripts/run-k6.mjs smoke --host-k6` requiere un binario k6 instalado y utiliza localhost del host.

Los datos ficticios se asocian con `RUN_ID`. DELETE es lógico y las pruebas incrementan el dataset. La limpieza administrativa se puede inspeccionar primero con `npm run k6:cleanup -- <RUN_ID>`; agregar `--confirm` elimina las reservas seleccionadas y sus eventos. Utilizarla solo en el entorno aislado de pruebas.

## Observabilidad con Grafana Cloud

La configuración implementada utiliza:

```text
M9 / m5-stub / m7-stub → OTLP/HTTP → Alloy → Grafana Cloud
                                                   ├─ métricas
                                                   ├─ logs
                                                   └─ trazas
k6 local → resultados de ejecución → Grafana Cloud k6 (opcional)
```

Se instrumentan HTTP, runtime Node, operaciones de reserva, degradaciones de tarifa, caché, locks, PostgreSQL, scheduler, Outbox, colas, Inbox y dependencias. Los logs conservan correlación y los eventos Outbox persisten contexto W3C para continuar las trazas tras una publicación diferida.

**Esta opción requiere credenciales en cada entorno que envíe datos a Cloud.** La ejecución local básica funciona sin ellas. No están implementados Grafana local ni un workflow GitHub Actions que distribuya o sustituya esa configuración.

### Configurar la cuenta una vez en esta PC

Crear `observability/.env.grafana-cloud` con un editor. El archivo está ignorado por Git y no debe publicarse. Si ya existe, conservar sus valores:

```powershell
notepad .\observability\.env.grafana-cloud
```

Contenido requerido; reemplazar los ejemplos con valores de la cuenta:

```dotenv
GRAFANA_CLOUD_OTLP_ENDPOINT=https://ENDPOINT-DEL-STACK/otlp
GRAFANA_CLOUD_OTLP_INSTANCE_ID=INSTANCE_ID
GRAFANA_CLOUD_OTLP_TOKEN=TOKEN_OTLP
K6_CLOUD_TOKEN=TOKEN_K6
K6_CLOUD_STACK_ID=STACK_ID
K6_CLOUD_PROJECT_ID=PROJECT_ID
```

El endpoint, Instance ID y token OTLP se obtienen en la configuración OpenTelemetry del stack. El token debe permitir `metrics:write`, `logs:write` y `traces:write`. Las variables `K6_CLOUD_*` corresponden a la integración de pruebas k6 y utilizan autenticación independiente.

Validar y levantar la composición con Alloy:

```powershell
$compose = @('-f', 'docker-compose.yml', '-f', 'docker-compose.observability.yml')
npm run obs:config
docker compose @compose run --rm --no-deps alloy validate /etc/alloy/config.alloy
npm run obs:up
docker compose @compose ps
docker compose @compose logs --tail 100 alloy
```

La interfaz de Alloy queda en <http://localhost:12345>. Grafana se abre en la dirección del stack Cloud; esta composición no instala un servidor Grafana en localhost.

### Comprobar las señales

Generar tráfico con `npm run k6:smoke`. En Grafana Cloud → Explore, seleccionar los últimos 15 minutos y la fuente correspondiente. Esperar la exportación, configurada cada 15 s por defecto.

Métricas, fuente Prometheus/Mimir:

```promql
m9_dependency_up{service_name="m9-reservas"}
```

Logs, fuente Loki de la aplicación:

```logql
{service_name="m9-reservas"} |= "http_request"
```

Trazas, fuente Tempo:

```traceql
{ resource.service.name = "m9-reservas" }
```

El log permite abrir la traza cuando la fuente Loki tiene configurado el enlace por `trace_id` hacia Tempo. El scheduler inicia trazas nuevas para trabajo diferido; la creación y una activación futura no tienen por qué compartir una única traza.

### Dashboards y alertas

Importar los JSON de `observability/grafana/dashboards/` desde Grafana → Dashboards → Import. Elegir las fuentes del stack en las variables de métricas, logs y trazas. **Para logs utilizar la fuente de la aplicación, no `alert-state-history`.**

Los paneles cubren API/runtime, reservas y procesamiento asíncrono. El archivo `observability/grafana/alerts/m9-alertas.rules.yaml` contiene ocho reglas en formato Prometheus/Mimir ruler. Se importan con el mecanismo correspondiente a reglas Mimir, o se recrean como reglas Grafana-managed; no se importan como dashboards.

Las reglas cubren 5xx, p95, dependencia caída, telemetría ausente, scheduler sin progreso, Outbox envejecido, reservas estancadas y DLQ. Su presencia en el repositorio no significa que estén instaladas o probadas en una cuenta.

```powershell
npm run obs:dashboards:check
```

El checker valida estructura y nombres de métricas; la comprobación final de paneles y alertas requiere datos reales en Grafana.

### Enviar resultados k6 a Cloud

Con las variables de k6 configuradas y cuota disponible:

```powershell
npm run k6:smoke:cloud
npm run k6:load:cloud
```

Para otros escenarios, invocar directamente el runner para asegurar que recibe `--cloud`:

```powershell
node scripts/run-k6.mjs stress --cloud
```

El runner utiliza ejecución local y envío de resultados; no necesita que Cloud acceda al localhost de la PC. El enlace de la corrida se muestra en la salida. Evitar agregar `--cloud` a comandos npm que no tengan un script dedicado si npm lo interpreta como configuración propia.

## Evidencias, resultados y limitaciones actuales

- `performance/results/`: resúmenes y metadatos k6.
- `observability/resultados/`: logs de verificación, capturas y resultados de revisión/ensayos.
- [Revisión final conservada](observability/resultados/revision-final-20261117/REVISION_FINAL_OBSERVABILIDAD.md): hallazgos y evidencias del estado revisado.
- `coverage/`: informes generados de cobertura, cuando se ejecuta esa suite.

La revisión conservada verificó ingesta real de métricas/logs/trazas y resultados k6 en Cloud. También registró pendientes que no deben darse por corregidos: la pantalla carga solo la primera página de reservas, el panel HTTP de k6 utiliza un filtro `message` incompatible con el Body OTLP actual y las reglas M9 no se encontraron importadas en la cuenta revisada. La consulta Loki indicada arriba evita ese filtro para comprobar la ingesta.

## Detener y volver a iniciar

Sin observabilidad:

```powershell
npm run local:down
npm run local:up
```

Con observabilidad:

```powershell
npm run obs:down
npm run obs:up
```

Estos comandos conservan los volúmenes. `npm run local:clean` elimina contenedores y volúmenes del proyecto y borra los datos locales; no es necesario para un reinicio normal.

## Resolución de problemas

| Problema                                   | Comprobación                                                                            |
| ------------------------------------------ | --------------------------------------------------------------------------------------- |
| No se encuentra un archivo Compose         | Ejecutar desde M9; desde la raíz, prefijar las rutas con `M9-ReservasProgramadas/`      |
| Docker no conecta                          | Abrir Docker Desktop, usar contenedores Linux y comprobar `docker version`              |
| Puerto ocupado                             | Revisar los puertos publicados; pueden personalizarse mediante las variables de Compose |
| Readiness 503                              | Revisar `docker compose ps` y logs de PostgreSQL/Redis/RabbitMQ                         |
| Falta `.env.grafana-cloud`                 | Usar `local:up` para pruebas sin Cloud o configurar el archivo antes de `obs:up`        |
| Alloy devuelve 401/403                     | Revisar token OTLP, Instance ID, permisos y stack                                       |
| Panel de logs vacío                        | Elegir la fuente Loki de aplicación y probar el filtro `\|= "http_request"`             |
| k6 no encuentra la red                     | Iniciar el Compose y revisar `K6_DOCKER_NETWORK`                                        |
| k6 termina con 99                          | Revisar los thresholds concretos; los resultados se conservan aunque fallen             |
| No aparecen reservas nuevas en la pantalla | Consultar la API con `page`/`pageSize`; la UI todavía no recorre páginas                |

Para revisar registros:

```powershell
docker compose logs --tail 100 m9-reservas
docker compose logs --tail 100 postgres redis rabbitmq
```

## Organización del módulo

```text
src/             API, dominio, servicios, repositorios e integraciones
src/stubs/       Dobles locales de M5 y M7
src/observability/ Instrumentación OpenTelemetry
prisma/          Esquema, migraciones y seed
public/          Interfaz web
openapi/         Contratos API
tests/           Pruebas unitarias, integración, infraestructura y E2E
scripts/         Runners, utilidades de observabilidad y limpieza de pruebas
performance/     Escenarios k6 y resultados
observability/   Alloy, dashboards, alertas y evidencias
```
