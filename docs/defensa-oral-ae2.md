# Guía de defensa oral AE2 — M9

## A. Resumen de 30 segundos

M9 administra reservas de viajes futuros. En AE1 tenía CRUD, scheduler e integración REST,
pero guardaba en memoria. En AE2 pasó a PostgreSQL, usa Redis para caché/locks y RabbitMQ
para activar una reserva de forma asíncrona. Outbox evita perder eventos, Inbox evita
duplicar efectos y una transición SQL condicional resuelve cancelación vs activación.

## B. Presentación de 7–10 minutos

1. **Problema:** mostrar una reserva futura y explicar que todavía no es un viaje.
2. **Responsabilidad:** M9 guarda/programa; no busca conductores ni cobra.
3. **Límites:** mostrar `data-ownership.md`; M5 despacha, M7 tarifa, M8 QR/PDF.
4. **AE1:** señalar InMemory y comunicación principalmente REST.
5. **Problema AE1:** reinicio, procesos múltiples y dual-write.
6. **AE2:** mostrar el diagrama de `architecture-ae2.md`.
7. **PostgreSQL/Prisma:** schema, migración y repositorio detrás de una interfaz.
8. **Redis:** cache-aside, TTL e invalidación; lock como coordinación, no garantía final.
9. **RabbitMQ:** dos direcciones de eventos y por qué no bloquean al scheduler.
10. **Outbox/Inbox:** explicar las dos transacciones y publisher confirm.
11. **Idempotencia:** `eventId` único e Idempotency-Key durable.
12. **Carrera:** dos updates esperan `PROGRAMADA`; solo uno afecta una fila.
13. **M5/M7:** REST oficial se conserva; eventos M5 son demo local pendiente de acuerdo.
14. **Testing:** mostrar 60 tests normales y las pruebas de infraestructura escritas.
15. **Evidencia:** diferenciar PASS de `BLOCKED_DOCKER_DAEMON`.
16. **Conclusión:** consistencia durable y límites más claros, sin incorporar AE4.

## Conceptos para responder

- **¿Por qué M9 está separado de M5?** M9 gestiona intención futura; M5 gestiona
  candidatos, ofertas y asignación inmediata.
- **¿Qué no hace M9?** No posee perfiles, ranking, viajes, pagos, QR ni PDF.
- **¿Por qué PostgreSQL?** Durabilidad, transacciones y condición por estado compartida.
- **¿Por qué Prisma?** Tipos/migraciones y un adapter que conserva el dominio desacoplado.
- **¿Por qué Redis si existe PostgreSQL?** Redis es rápido y efímero; PostgreSQL es verdad.
- **Cache-aside:** primero caché, ante miss base, luego poblar; escrituras invalidan/actualizan.
- **TTL:** expiración automática que limita datos obsoletos.
- **Distributed Lock:** reduce trabajo simultáneo entre procesos.
- **¿Por qué no alcanza el lock?** Puede expirar; el `UPDATE ... WHERE status=PROGRAMADA`
  decide definitivamente.
- **Transición atómica:** valida y cambia estado como una sola operación indivisible.
- **¿Por qué RabbitMQ?** Desacopla temporalmente scheduler y despacho y tolera caídas.
- **¿Por qué no solo REST?** REST requiere respuesta en línea; un evento puede procesarse
  después y reintentarse.
- **Asíncrono vs serverless:** no son sinónimos. Uno describe comunicación temporal; el otro,
  un modelo de ejecución/infraestructura.
- **Dos flujos:** `reservation.ready-for-dispatch.v1` y
  `ride-request.assigned.v1`/`failed.v1`.
- **Publisher confirm:** el broker confirma recepción; recién entonces Outbox es PUBLISHED.
- **Retry/DLQ:** reintento diferido y cola final para mensajes que exceden el límite.
- **Idempotencia:** repetir la misma operación no duplica el efecto.
- **Idempotency-Key:** identifica la misma creación lógica frente a timeout/reinicio.
- **Outbox vs Inbox:** Outbox asegura salida; Inbox deduplica entrada con el efecto.
- **Rabbit caído:** negocio se confirma y Outbox queda PENDING.
- **Redis caído:** la verdad permanece; caché/lock quedan degradados.
- **PostgreSQL caído:** readiness es degraded y no se aceptan operaciones durables.
- **Duplicado:** la PK de Inbox hace que uno sea PROCESSED y otro DUPLICATE.
- **Cancelación vs activación:** ambos compiten por estado PROGRAMADA; un solo update gana.
- **Dos activaciones:** misma condición SQL y clave durable; solo una genera ready event.
- **correlationId:** atraviesa HTTP/eventos/logs para reconstruir el recorrido.
- **Ownership:** cada servicio escribe su dato y comparte contratos, no tablas.
- **Integración M5:** REST oficial y eventos locales de AE2 pendientes de acuerdo definitivo.
- **Integración M7:** `POST /tarifa/estimacion`, timeout y adapter de DTO.
- **QR/PDF:** son de M8 y ocurren después de crear el viaje/pago.
- **AE4:** cloud, HA, métricas/trazas, Circuit Breaker y CI/CD completo.

## Preguntas que puede hacer el profesor

| # | Pregunta | Respuesta breve | Evidencia para mostrar |
| --- | --- | --- | --- |
| 1 | ¿Dónde está la fuente de verdad? | PostgreSQL. | `schema.prisma`, ADR-001 |
| 2 | ¿Redis contiene reservas definitivas? | No, solo caché. | ADR-002 |
| 3 | ¿Qué ocurre al reiniciar? | Prisma recupera reserva y key. | test infraestructura |
| 4 | ¿Cómo evita dual-write? | Reserva+Outbox en una transacción. | `PrismaReservaRepository` |
| 5 | ¿Cuándo queda PUBLISHED? | Tras publisher confirm. | publisher/outbox processor |
| 6 | ¿Qué evita duplicados? | PK `eventId` y transacción Inbox. | migración/processor |
| 7 | ¿Por qué at-least-once? | Puede redeliver; se tolera con idempotencia. | catálogo |
| 8 | ¿Cuántos reintentos? | Configurable; luego DLQ. | env/consumer |
| 9 | ¿Hay loop infinito? | No, `x-retry-count` tiene límite. | consumer/test |
| 10 | ¿Qué pasa si DLQ falla? | Outbox sigue PENDING. | test unitario |
| 11 | ¿Lock Redis garantiza todo? | No; el update SQL es final. | ADR-002/test carrera |
| 12 | ¿Qué pasa si cancelar pierde? | Recibe conflicto/estado en proceso. | `ReservaService` |
| 13 | ¿M9 elige conductor? | No, solo guarda el ID de M5. | ownership |
| 14 | ¿Implementaron RF-9.7? | Bloqueado por contrato M5. | matriz/auditoría |
| 15 | ¿El evento M5 es oficial? | Es demo local explícita. | catálogo |
| 16 | ¿Por qué conservar REST? | Compatibilidad y operaciones síncronas. | ADR-003 |
| 17 | ¿Cómo se valida entrada? | Zod y error consistente. | schemas/OpenAPI |
| 18 | ¿Qué muestra readiness? | PostgreSQL, Redis y RabbitMQ. | `/readiness` |
| 19 | ¿Liveness y readiness difieren? | proceso vivo vs aptitud con dependencias. | health/readiness routes |
| 20 | ¿Guardan secretos? | No; `.env.example` usa valores locales. | gitignore/env |
| 21 | ¿Por qué no QR/PDF? | Owner M8 y falta `tripId`. | `out-of-scope.md` |
| 22 | ¿Qué no pudieron validar? | Infra/E2E por daemon Docker apagado. | testing evidence |
| 23 | ¿Qué cobertura tienen? | Usar el último reporte real. | `npm run test:coverage` |
| 24 | ¿Cómo escalaría a dos instancias? | DB/Redis/Rabbit son compartidos; no memoria. | Compose + test multi-client |

## Guion de demo

```bash
cd M9-ReservasProgramadas
npm ci
npm run local:up
docker compose ps
curl http://localhost:3000/health
curl http://localhost:3000/readiness
```

Abrir `http://localhost:3000/docs/`, crear una reserva con fecha próxima, consultarla y
observar `PROGRAMADA → ACTIVANDO → ACTIVADA`. Abrir Rabbit Management en
`http://localhost:15672/` y mostrar exchanges/queues. Reiniciar solo M9 con
`docker compose restart m9-reservas` y volver a consultar. Luego ejecutar:

```bash
npm run test:infrastructure
npm run test:e2e
npm run test:coverage
```

Para duplicado/retry/DLQ y concurrencia, explicar cada nombre de test y mostrar su resultado,
no el código completo.

### Plan B

Si Docker falla: mostrar diagramas/ADR, OpenAPI versionado, último resultado textual real de
`npm run verify`, coverage HTML y señalar honestamente `BLOCKED_DOCKER_DAEMON`. No afirmar
que una evidencia bloqueada pasó.

## Cheat sheet

- Arquitectura: M9 + PostgreSQL (verdad) + Redis (efímero) + RabbitMQ (eventos).
- Eventos: ready-for-dispatch; assigned/failed.
- Patrones: cache-aside, distributed lock, Outbox, Inbox, idempotencia.
- Carrera: cancelación vs activación, update condicional por `PROGRAMADA`.
- Límites: M5 despacha; M7 tarifa; M8 QR/PDF.
- Comandos: `npm run local:up`, `npm run verify`, `npm run test:coverage`,
  `npm run test:infrastructure`, `npm run test:e2e`.
- Cinco conceptos: ownership, asincronía, consistencia eventual, idempotencia y
  correlación.
