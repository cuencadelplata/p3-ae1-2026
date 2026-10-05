# RF-8.2 en AE2: alcance, evidencias y pruebas

## Alcance individual

- **Escenario:** Movilidad urbana, Módulo 8. RF-8.2 «QR de verificación» (S2-AE2.4), con RNF-06
  (Redis con expiración) y la regla de no exponer datos personales en QR, logs ni URLs.
- **Base:** AE1 `2f20843`, último commit de QR en `feature/m8-r82-qr-grupo6`, y el baseline
  compartido `fbc0592`. La branch `ae2/bautista-goya` parte de `d124ce1`. La cátedra puede fijar
  otro tag oficial de AE1.
- **Comprometido:**
  - QR en Redis con TTL y consumo atómico de un solo uso, válido entre instancias;
  - 503 fail-closed ante Redis caído o lento;
  - health por dependencia y logs con correlación;
  - contrato OpenAPI 2.0.0;
  - pruebas de concurrencia y resiliencia.
- **Dependencias:** Redis, con prefijo propio `m8:qr:`. M6 es el consumidor HTTP y decide el
  inicio del viaje.
- **Fuera de alcance:** cambios de estado del viaje (M6), mensajería, autenticación e
  integración real con M6.

## Herencia AE1 → AE2

| Componente (`services/qr/`) | Estado | Commits |
| --- | --- | --- |
| `qr-generator.ts`, `qr.validator.ts`, `qr.types.ts` | Heredado sin cambios | — |
| `qr.store.ts`: interfaz asíncrona; el store en memoria queda para pruebas | Modificado | 3eee50c, f6a0e77, 4f7f70a |
| `qr.service.ts`, `qr.controller.ts`, `qr.config.ts`, `app.ts`, `server.ts`, `http/api-error.ts`, `http/error-handler.ts` | Modificado | 3eee50c, f6a0e77, a2495c4, 4de7181, 280cd86, 4f7f70a |
| `qr.redis-store.ts`, `qr.redis-scripts.ts`, `redis-client.ts` | Nuevo | f6a0e77, 4f7f70a, 4f93950 |
| `health.ts`, `shutdown.ts`, `observability/logger.ts`, `http/request-context.ts` | Nuevo | a2495c4, 4de7181, 280cd86 |
| `openapi/qr.openapi.yaml` (2.0.0), `package.json`, `Dockerfile`, `compose.yaml` | Modificado | 52d7afa, 280cd86, 1a234cd, 678115c, 1aeba18 |
| 7 archivos de prueba de AE1 | Adaptados a async con las mismas aserciones | 3eee50c |

## Evidencia por criterio de la rúbrica

| # | Criterio | Evidencia | Archivo o commit |
| --- | --- | --- | --- |
| 1 | Trazabilidad AE1→AE2 | Base y tabla de herencia de este documento | `git log d124ce1..HEAD` |
| 2 | RF implementado | Generar, validar y reutilizar por HTTP; vencimiento (410) por HTTP; E2E contra Docker | `qr.integration.test.ts`, `qr.logging.test.ts`, `tests/e2e/workspace-api.e2e.test.mjs` |
| 3 | Evolución arquitectónica | Store inyectable, app sin efectos al importar, Redis detrás de `QrStore`; M8 no cambia el viaje | 3eee50c, f6a0e77, ADR-001 |
| 4 | Contratos y comunicación síncrona | OpenAPI 2.0.0 validado (referencias y ejemplos) y coherente con el código; nota para M6 | `qr.openapi.yaml`, `contrato-m6.md` |
| 5 | Comunicación asíncrona | No aplica a RF-8.2: M6 necesita el resultado de la validación para decidir el inicio del viaje, así que es una consulta síncrona; un evento no desacoplaría nada | — |
| 6 | Redis y estado efímero | Clave y TTL, 410 dentro del margen y 404 después, recuperación tras `SCRIPT FLUSH` | `qr.redis-store.test.ts` |
| 7 | Concurrencia e idempotencia | Carrera demostrada con un store ingenuo y evitada con Lua, también entre dos instancias; mutación | `qr.concurrency.test.ts`, 51900c1 |
| 8 | Propiedad de datos | Sólo el hash del token y la referencia al viaje; prefijo propio; ningún dato de M6 | README (Datos en Redis), ADR-001 |
| 9 | Artefacto QR | El PNG se decodifica en la prueba y contiene sólo el token | `qr-generator.test.ts` |
| 10 | Testing y reproducibilidad | Reporte de abajo; comandos en bash y PowerShell en el README | este documento, README |
| 11 | Trazabilidad individual | Commits `rf8.2` de la branch; issues: pendiente | `git log d124ce1..HEAD` |
| 12 | Fundamentación | Alternativas comparadas, hallazgo del timeout, pendientes | ADR-001 |

## Reporte de pruebas

Medido el 2026-10-04 sobre `86d9251`, con Node 24.19.0, pnpm 10.33.0, Redis 7.4.11 y Windows 11.
Los comandos están en el README.

| Verificación | Resultado |
| --- | --- |
| `typecheck`, `typecheck:test`, `build` | Sin errores |
| Suite | 226 pruebas en 19 archivos (142 unitarias, 84 de integración con Redis real), todas aprobadas |
| Concurrencia: N validaciones simultáneas del mismo QR | Store ingenuo con N=10: 10×200. Lua con N=10, 20 y 100: 1×200 y N−1×409. Dos instancias con N=20: 1×200 y 19×409. Memoria, generar en A y validar en B: 404. Vencido con N=10: 10×410. Viajes mezclados: viaje correcto 1×200 y 9×409, otro viaje 10×404 |
| Mutación: consumo en dos pasos sin Lua | Fallan 5 de 10 pruebas de concurrencia: solución con N=10, 20 y 100, dos instancias y viajes mezclados |
| Resiliencia con proxy TCP y tope de 300 ms | Redis caído: 503 en 2–6 ms, ready 503, live 200. Redis colgado: 503 en 305–307 ms, y al volver la misma validación da 200. Respuesta perdida: 503 en 305–318 ms, y al volver 409. Corte con el comando en vuelo: 503 en 20–22 ms. Recuperación: ready 200 a los 190–194 ms |
| Estabilidad | 5 corridas seguidas de concurrencia y 5 de resiliencia, sin fallas |
| Docker | E2E de QR aprobado. Con Redis detenido: 503 con `Retry-After: 5` en 8 y 3 ms; el healthcheck del contenedor siguió con exit 0 (healthy). Recuperación sin reiniciar el contenedor. `docker compose stop qr`: 577 ms, exit 0, cierre ordenado |
