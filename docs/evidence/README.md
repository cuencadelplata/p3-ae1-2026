# Índice de evidencias

| Evidencia | Ubicación/comando | Estado actual |
| --- | --- | --- |
| Build/typecheck/lint/formato | `npm run verify && npm run build` | código ejecutable; ver `testing-evidence.md` |
| Unit/integration | `npm test` | PASS |
| Coverage HTML | `npm run test:coverage`, `M9-ReservasProgramadas/coverage/index.html` | PASS |
| Migración desde cero | `npm run test:infrastructure` | BLOCKED_DOCKER_DAEMON |
| Redis TTL/cache/lock | `tests/infrastructure/backing-services.spec.ts` | escrita; ejecución bloqueada |
| Outbox/Inbox/duplicado/reinicio | mismo archivo | escrita; ejecución bloqueada |
| RabbitMQ flows/retry/DLQ | infraestructura + E2E | escrita; ejecución bloqueada |
| Multi-client/concurrencia | infraestructura | escrita; ejecución bloqueada |
| Swagger/OpenAPI | `/docs/`, `/openapi.json` | test normal PASS |
| Docker health/readiness | `docker compose ps`, `/readiness` | BLOCKED_DOCKER_DAEMON |

Guardar aquí únicamente evidencias legibles de ejecuciones reales. No copiar secretos,
archivos `.env` ni capturas de código.
