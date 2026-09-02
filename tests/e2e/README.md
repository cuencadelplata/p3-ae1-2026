# Pruebas E2E

E2E verifica el Módulo 8 desde afuera, usando el servicio real dentro de un contenedor Docker temporal.

- `api/`: pruebas automatizadas de las APIs públicas mediante HTTP real con Vitest.
- `ui/`: prueba de la interfaz mediante Playwright y Chromium.
- `infrastructure/`: no contiene casos de prueba; prepara el entorno Docker necesario para los E2E.

```text
E2E API
Vitest → Docker → HTTP → M8

E2E UI
Playwright/Chromium → Docker → UI M8 → backend real
```

Los comandos son `pnpm test:e2e:api`, `pnpm test:e2e:ui` y `pnpm test:e2e`.

La infraestructura espera `GET /health` antes de ejecutar los casos, sin generar notificaciones ni QR como efecto de readiness.
