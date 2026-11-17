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

## Servicios

| Servicio | Puerto local | Responsabilidad |
| --- | ---: | --- |
| Viajes | 3000 | RF-6.1/6.2/6.3, persistencia y ciclo de vida |
| Cancelaciones | 3001 | RF-6.5/6.6, delega cambios a Viajes y publica eventos |
| Fachada | 3002 | RF-6.4/6.7, finalización e historial; front de registro de viajes en `/` |
| PostgreSQL | 5432 | Base compartida `tripdb` |
| Redis | 6379 | Caché compartida |
| RabbitMQ | 5672, gestión 15672 | Eventos de viajes y cancelaciones |

Compose inicia un simulador interno para las dependencias M3/M4/M7/M8. Los tres servicios M6 comparten la misma imagen Node y la misma base; `docker compose down` detiene el entorno y conserva el volumen de PostgreSQL.

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