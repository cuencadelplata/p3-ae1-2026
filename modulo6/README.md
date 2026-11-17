# M6 integrado

Los requisitos RF-6.1/6.2/6.3, RF-6.4/6.7 y RF-6.5/6.6 comparten un único proyecto Node, configuración de TypeScript/Vitest y stack Docker. Cada API conserva su límite y sus rutas.

## Requisitos

- Node.js 20 o superior y npm.
- Docker con Docker Compose para las pruebas E2E y los servicios de infraestructura.

## Instalar y probar

Desde esta carpeta:

```sh
npm ci
npm run docker:up
npm test
npm run build
npm run test:e2e
npm run docker:down
```

Antes de levantar Compose:

- En `modulo6/.env`, configura `M7_URL` y `M7_API_KEY` para la API real de M7.
- En `modulo8/.env`, configura `QR_INTERNAL_API_KEY` con una clave de al menos 16 caracteres. M6 la lee desde ese archivo y la envía a M8 como `x-api-key`.
- Ten disponible la red `m1-integracion_default`, requerida por el Compose de integración de M8.

`npm run docker:up` crea la red `m6_viajes_default` y levanta M6. Después, desde `modulo8/`, conecta M8 a esa red. El override dentro de M6 evita conflictos entre los puertos publicados de ambos módulos:

```sh
docker compose --env-file .env -f compose.yaml -f compose.integracion-real.yaml -f ../modulo6/docker-compose.m8-hostports.yml up -d --build --wait
```

La URL interna configurada es `http://m8-app:3000`. M6 conserva sus puertos locales habituales; M8 queda publicado en `http://localhost:3103` para las comprobaciones desde el host. M3 y M4 continúan usando el simulador de M6.

Para detener M8 desde `modulo8/` y luego M6 desde `modulo6/`:

```sh
docker compose --env-file .env -f compose.yaml -f compose.integracion-real.yaml -f ../modulo6/docker-compose.m8-hostports.yml down
npm run docker:down
```

Las pruebas unitarias de RF-6.1/2/3 usan PostgreSQL y Redis reales, por eso se levantan con Compose. Para ejecutar una familia concreta:

```sh
npm run test:rf-6.1-6.2-6.3
npm run test:rf-6.4-6.7
npm run test:rf-6.5-6.6
```

## Pruebas de carga con K6

Instala [K6](https://grafana.com/docs/k6/latest/set-up/install-k6/) y levanta el stack con `npm run docker:up`. Desde esta carpeta, ejecuta:

```sh
npm run k6:smoke
npm run k6:load
npm run k6:stress
```

Los perfiles comprueban `/health` y ejecutan el flujo de crear y consultar un viaje en la API central (`http://localhost:3000`). Smoke ejecuta 5 iteraciones con 1 VU; carga escala hasta 20 VUs; estrés escala progresivamente a 100 VUs, mantiene ese nivel durante 1 minuto y luego reduce la carga. Los perfiles de carga y estrés duran 2 y 3.5 minutos, respectivamente. Se exige p95 menor a 1 s, menos de 1% de solicitudes fallidas y más de 99% de checks exitosos. Para cambiar la URL, ejecuta K6 directamente, por ejemplo: `k6 run --env K6_PROFILE=stress --env BASE_URL=http://localhost:3000 k6/viajes.js`.

Cada iteración crea un viaje y lo deja persistido en PostgreSQL; el perfil de estrés puede crear muchos registros. Usa un entorno de pruebas y limpia esos datos cuando ya no los necesites.

`npm run test:e2e` requiere el stack en ejecución. También se puede seleccionar una familia con `test:e2e:rf-6.1-6.2-6.3`, `test:e2e:rf-6.4-6.7` o `test:e2e:rf-6.5-6.6`.
Para el harness Docker que prueba generación y validación de QR en M8, exporta `M8_URL=http://m8-app:3000`, `M8_TEST_URL=http://localhost:3103` y `M8_QR_API_KEY` con el mismo secreto de `QR_INTERNAL_API_KEY`.

## Interfaz web

El frontend de RF-6.1/6.2/6.3 se sirve desde la misma API M6, en `http://localhost:3000`, por lo que no necesita un contenedor ni configuración CORS aparte. Levanta M6 y M8 con los comandos anteriores y abre esa URL. La pantalla permite solicitar y consultar viajes, asignar un conductor manualmente para la demo, registrar el arribo, recuperar el QR vigente y solicitar el inicio validando el token con M8.

## Servicios

| Servicio | Puerto local | Responsabilidad |
| --- | ---: | --- |
| Viajes | 3000 | RF-6.1/6.2/6.3, persistencia y ciclo de vida |
| Cancelaciones | 3001 | RF-6.5/6.6, delega cambios a Viajes y publica eventos |
| Fachada | 3002 | RF-6.4/6.7, finalización e historial; front de registro de viajes en `/` |
| PostgreSQL | 5432 | Base compartida `tripdb` |
| Redis | 6379 | Caché compartida |
| RabbitMQ | 5672, gestión 15672 | Eventos de viajes y cancelaciones |

Compose inicia un simulador interno únicamente para M3/M4. El QR se solicita y valida contra M8 real (`m8-app:3000`); las llamadas de tarifa y pago de M7 se dirigen a la API real mediante `M7_URL` y `M7_API_KEY`. Los tres servicios M6 comparten la misma imagen Node y la misma base; `npm run docker:down` detiene M6 y conserva el volumen de PostgreSQL.

## Front de RF-6.4 / RF-6.7

Con el stack levantado, abrir **http://localhost:3002/**. La fachada sirve una página propia (`frontend-rf-6.4-6.7/`) que:

- lista el registro de viajes (`GET /api/viajes`) filtrando por cliente, conductor y estado, con paginación; los filtros quedan en la URL para compartir la búsqueda;
- muestra el detalle de un viaje: datos, resumen de la finalización y la línea de tiempo del historial de transiciones (solo inserción);
- permite **finalizar** un viaje en curso (RF-6.4) con efectivo, transferencia o tarjeta (token de prueba; con el simulador, el token `rechazado` devuelve 402).

## Observabilidad (logs, métricas y trazas)

Cada servicio M6 emite:

- **Trazas OpenTelemetry**: HTTP (fachada → Viajes), PostgreSQL, llamadas a M4/M7 y publicación en RabbitMQ. El outbox continúa la traza de la solicitud que finalizó el viaje. Los spans con viaje llevan el atributo `m6.trip_id`.
- **Logs JSON** (pino) con `requestId` (`X-Request-Id`, se propaga de la fachada a Viajes), `tripId`, `trace_id` y `span_id`. Los datos de pago, emails y tokens se ocultan.
- **Métricas Prometheus** en `GET /metrics` (prefijo `m6_`): solicitudes HTTP, finalizaciones por resultado, latencia de M4/M7, consultas al historial, eventos publicados, outbox pendiente y viajes por estado.

Levantar el stack de observabilidad local (Alloy, Prometheus, Loki, Tempo y Grafana):

```sh
docker compose --profile observability up -d
```

Grafana queda en **http://localhost:3003** (admin / `admin`, o `GRAFANA_ADMIN_PASSWORD`) con el dashboard **M6 · Finalización (RF-6.4) e historial (RF-6.7)**. Escribir un `tripId` arriba filtra los logs y las trazas de ese viaje; desde un log se abre la traza y viceversa.

Para enviar además a **Grafana Cloud** (como hacen los demás módulos), copiar [observabilidad/grafana-cloud.env.example](observabilidad/grafana-cloud.env.example) a `modulo6/.env` (ignorado por Git), completar las credenciales y volver a levantar el perfil. Con `ALLOY_CONFIG=config.cloud.alloy`, Alloy envía las métricas por remote write y las trazas y logs por el OTLP gateway. El dashboard se importa en Grafana Cloud desde [observabilidad/grafana/dashboards/m6-rf64-rf67.json](observabilidad/grafana/dashboards/m6-rf64-rf67.json) y se eligen los datasources de la cuenta en los selectores de arriba.

Sin el perfil `observability` todo funciona igual: los servicios descartan la telemetría OTLP y `/metrics` sigue disponible.

Si otro módulo ya usa esos puertos en la misma máquina, se pueden cambiar sin editar el compose (por ejemplo en `modulo6/.env`):

| Variable | Servicio | Por defecto |
| --- | --- | ---: |
| `M6_GRAFANA_PORT` | Grafana | 3003 |
| `M6_PROMETHEUS_PORT` | Prometheus | 9090 |
| `M6_LOKI_PORT` | Loki | 3100 |
| `M6_TEMPO_PORT` | Tempo | 3200 |
| `M6_ALLOY_PORT` | UI de Alloy | 12345 |

Sólo cambia el puerto publicado en el host; dentro de la red de Docker los servicios se siguen comunicando por sus puertos internos.

## Mini front-end RF-6.5/6.6

Con el stack levantado, abre `http://localhost:3001/cliente` para RF-6.5 o `http://localhost:3001/conductor` para RF-6.6. La pantalla muestra el viaje actual y solo solicita el motivo; al confirmar, llama a la API de cancelación correspondiente. El ID llega en `?viajeId=...` desde el contexto que abre la cancelación o se obtiene automáticamente del listado de la cuenta.

El módulo que conoce la sesión debe pasar `viajeId` directamente, o bien `clienteId`/`conductorId` para que la pantalla busque el viaje cancelable más reciente. Si falta todo contexto, la pantalla informa que no puede identificar el viaje. También usa `m6-client-id` o `m6-conductor-id` de `localStorage` como alternativa en el mismo origen.

Las APIs RF-6.5/6.6 no autentican ni identifican por sí solas a la persona que abre la pantalla. Las rutas fijan el flujo, pero no sustituyen autenticación; el módulo que conoce la sesión debe pasar el `clienteId` o `conductorId` correspondiente.

## Integración del QR con M8

M6 llama al M8 real en `http://m8-app:3000` por la red compartida `m6_viajes_default`. `QR_INTERNAL_API_KEY` se configura en `modulo8/.env` y M6 la recibe como `M8_QR_API_KEY`. El archivo `docker-compose.m8-hostports.yml`, ubicado en M6, se agrega al Compose de M8 para publicar su API en `localhost:3103` y despublicar su PostgreSQL, Redis y RabbitMQ del host; M6 mantiene sus puertos locales sin cambios.

## Contratos

- Todos los requisitos: [OpenAPI consolidado](openapi.yaml)

## Estructura

```text
modulo6/
├── src/
│   ├── rf-6.1-6.2-6.3/
│   ├── rf-6.4-6.7/
│   └── rf-6.5-6.6/
├── tests/
│   ├── rf-6.1-6.2-6.3/
│   ├── rf-6.4-6.7/
│   └── rf-6.5-6.6/
├── tests-e2e/
│   ├── rf-6.1-6.2-6.3/
│   ├── rf-6.4-6.7/
│   └── rf-6.5-6.6/
├── simulator/
│   ├── rf-6.1-6.2-6.3/   # mock M8
│   ├── rf-6.4-6.7/
│   └── rf-6.5-6.6/
├── rf-6.1-6.2-6.3/   # SQL y documentación específica
├── rf-6.4-6.7/       # documentación específica
├── rf-6.5-6.6/       # contratos auxiliares y documentación
├── openapi.yaml      # especificación unificada de las tres APIs
├── docker-compose.yml
└── package.json
```