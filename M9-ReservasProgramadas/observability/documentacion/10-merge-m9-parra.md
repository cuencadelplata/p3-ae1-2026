# 10 · Merge de la rama de Parra (+ AE4) hacia M9

Rama del merge: `ae4/m9-merge-parra`, creada desde `M9-ReservasProgramadas` (0f00daf) y
mergeando `ae4/m9-observabilidad` (= `ae2/parra-ingaramo-ignacio` + observabilidad AE4).
`M9-ReservasProgramadas` **no se modificó**: el merge queda en una rama aparte para revisión.

## Comparación de las dos ramas

Ancestro común: `c900128` (2026-09-23, CRUD base). Desde ahí cada rama hizo su propio AE2
sobre los mismos archivos, por eso hubo 28 archivos en conflicto.

| Tema                 | `M9-ReservasProgramadas` (21 commits)                                                     | `ae2/parra-ingaramo-ignacio` (10 commits)                                                                        |
| -------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Esquema Prisma       | Español: `reservas`, `reserva_versiones`, `outbox_eventos`; estado `PENDIENTE_ASIGNACION` | Inglés: `reservations`, `outbox_events`, `inbox_events`; estados PROGRAMADA→ACTIVANDO→ACTIVADA/FALLIDA           |
| Historial            | Tabla de versiones por reserva                                                            | Sin tabla de versiones (columna `version`)                                                                       |
| Redis                | No                                                                                        | Caché + locks distribuidos                                                                                       |
| RabbitMQ             | No                                                                                        | Outbox worker, retry, DLQ, Inbox idempotente                                                                     |
| Asignación de chofer | M9 pide ofertas a M5 (`/asignaciones/{id}`)                                               | M5 busca conductores; M9 guarda el asignado (eventos `ride-request.*`)                                           |
| Cliente M5           | Coordenadas fijas, `x-client-id`, respuesta `{solicitudId, estado}`, stub en **:3005**    | Ruta resuelta, Bearer, Idempotency-Key persistida, respuesta `{id, status, assignedDriverId}`, stub en **:3001** |
| Listado              | **Paginado** `page`/`pageSize`                                                            | Sin paginación                                                                                                   |
| Caída de PostgreSQL  | **503** `BASE_DATOS_NO_DISPONIBLE`                                                        | 500 genérico                                                                                                     |
| `/health`            | Incluye dependencias y responde 503 si alguna falla                                       | Solo vida del proceso; dependencias en `/readiness`                                                              |

## Decisiones de resolución

Base resuelta: **la versión de Parra + AE4**, porque es la arquitectura completa
(Redis/RabbitMQ/Outbox/Inbox) sobre la que está construida la observabilidad del AE4.
De M9 se **conservó**:

1. **Listado paginado**: `GET /reservas?page=&pageSize=` (por defecto 1 y 20, máximo 100),
   respuesta `{ reservas, page, pageSize }`. Implementado en repositorio Prisma
   (`orderBy fecha, id` + `skip/take`, medido como `reservation.list_page`) y en memoria;
   documentado en OpenAPI y cubierto por un test nuevo. Además reduce el riesgo que el AE4
   marcaba sobre el listado sin paginación.
2. **Error 503 cuando PostgreSQL no está disponible** (`error.middleware.ts` + test).

De M9 **no** se conservó (queda para decidir con el equipo):

| Elemento                                                                                        | Motivo                                                                                                                                     |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Esquema en español y migraciones `20261002000000_init` / `20261004000000_add_reservas_outbox`   | Crearían tablas paralelas que el código no usa. **Una base creada con esas migraciones no se migra automáticamente**: usar una base nueva  |
| Tabla `reserva_versiones`                                                                       | Depende del esquema en español; portarla requiere migración y cambios de repositorio                                                       |
| Cliente/stub M5 de M9 (`despacho.client.ts`, `asignacion.client.ts`, `ofertas.ts`, puerto 3005) | Contrato incompatible con el de Parra. **Confirmar con M5 cuál es el contrato vigente**                                                    |
| `/health` con dependencias                                                                      | El healthcheck de Compose usa `/health`: con 503 por M5 caído, el contenedor quedaría _unhealthy_. Las dependencias siguen en `/readiness` |

## Verificación del merge

Ver la sección de resultados del commit de merge (typecheck, lint, tests, build y checker de
dashboards). Docker y Grafana Cloud siguen pendientes, igual que en la rama AE4.
