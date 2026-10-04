# Evidencia técnica y pruebas AE2

Fecha de última ejecución local registrada: 4 de octubre de 2026.

| Comprobación | Resultado observado | Comando |
| --- | --- | --- |
| Instalación limpia | PASS | `npm ci` |
| Prisma schema | PASS con Prisma 6.12.0 | `npx prisma validate` con `DATABASE_URL` local |
| Typecheck | PASS | `npm run typecheck` |
| Lint | PASS | `npm run lint` |
| Build | PASS | `npm run build` |
| Tests normales | PASS, 60/60 | `npm test` |
| Coverage | PASS thresholds; 89,86% statements, 77,99% branches, 93,54% functions, 91,54% lines | `npm run test:coverage` |
| Compose config | PASS, con advertencia local de acceso a config Docker | `docker compose config --quiet` |
| Auditoría npm | PASS, 0 vulnerabilidades | `npm audit` |
| Infra PostgreSQL/Redis/RabbitMQ | `BLOCKED_DOCKER_DAEMON` | `npm run test:infrastructure` |
| Docker build/health/E2E | `BLOCKED_DOCKER_DAEMON` | `npm run test:e2e` |

Los porcentajes se deben reemplazar si una ejecución posterior produce otros valores. No se
declara PASS para infraestructura/E2E hasta ejecutar los contenedores.

Escenarios de infraestructura incluidos: TTL/invalidation, lock/token, persistencia tras
reconexión, Idempotency-Key durable, Outbox pendiente/recuperación, Inbox duplicada con dos
clientes, cancelación vs activación, publisher confirm, retries y DLQ.
