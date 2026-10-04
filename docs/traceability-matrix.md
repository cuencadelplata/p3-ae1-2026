# Matriz de trazabilidad AE2

Estados permitidos: `PASS`, `PARTIAL`, `BLOCKED`, `OUT_OF_SCOPE`.

| Requisito | Implementación | Tests/evidencia | Estado |
| --- | --- | --- | --- |
| RF-9.1 Crear reserva | `ReservaService`, `PrismaReservaRepository` y Outbox transaccional | tests de reservas y persistencia | PASS |
| RF-9.2 Consultar reserva | REST + cache-aside Redis + PostgreSQL | integración HTTP y prueba Redis | PASS |
| RF-9.3 Modificar reserva | PATCH condicional solo `PROGRAMADA`, recálculo M7 | integración de reservas/M7 | PASS |
| RF-9.4 Cancelar reserva | cancelación lógica y transición condicional | concurrencia y conflicto durante despacho | PASS |
| RF-9.5 Activar reserva | scheduler, `PROGRAMADA→ACTIVANDO`, Outbox y eventos M5 | E2E escrito; ejecución Compose pendiente | PARTIAL |
| RF-9.6 Tarifa estimada | cliente M7 y snapshot | tests del cliente y flujo CRUD | PASS |
| RF-9.7 Mejor calificación | M9 no selecciona conductores | falta contrato M5 para criterio/reasignación | BLOCKED |
| RNF-04 Propiedad de datos | DB y esquema exclusivos de M9; solo IDs externos | `data-ownership.md` y schema Prisma | PASS |
| RNF-05 APIs y contratos | OpenAPI M9 2.0.0, clientes M5/M7 | Swagger y tests de contrato | PASS |
| RNF-06 Redis | cache-aside, TTL, invalidación y lock con token | unit PASS; infraestructura pendiente de Docker | PARTIAL |
| RNF-07 RabbitMQ | ready-for-dispatch y assigned/failed | tests escritos; ejecución real pendiente | PARTIAL |
| RNF-08 Idempotencia | key durable, Outbox único e Inbox PK `eventId` | tests de reinicio/duplicado escritos | PARTIAL |
| RNF-09 Concurrencia | update condicional PostgreSQL + lock Redis | cancelación vs activación multi-client escrita | PARTIAL |
| RNF-10 Seguridad | Zod, Helmet, secretos externos, logs sin credenciales | revisión local sin secretos reales; autenticación M1 pendiente | PARTIAL |
| RNF-11 Configuración externa | Zod env y `.env.example` | typecheck y Compose config | PASS |
| RNF-13 Logs/correlación | JSON logger, HTTP/event/scheduler correlationId | revisión de código; demo pendiente | PARTIAL |
| RNF-16 Health checks | `/health` y PostgreSQL/Redis/RabbitMQ en `/readiness` | unit PASS; contenedor pendiente | PARTIAL |
| RNF-17 Testing | unit/integration/infra/E2E/coverage | 60 tests normales PASS; Docker pendiente | PARTIAL |
| RNF-22 Versionado/gestión | versión 2.0.0 y branch individual | issues, tag y release requieren cierre manual | PARTIAL |
| QR temporal | Responsabilidad M8 | `out-of-scope.md` | OUT_OF_SCOPE |
| PDF comprobante | Responsabilidad M8 | `out-of-scope.md` | OUT_OF_SCOPE |
| AE4: cloud/HA/observabilidad/CI-CD | No implementado en AE2 | alcance oficial | OUT_OF_SCOPE |
