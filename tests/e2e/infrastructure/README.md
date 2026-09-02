# Infraestructura E2E

Esta carpeta **NO contiene casos de prueba**. Contiene únicamente el soporte que prepara y limpia el entorno Docker usado por los E2E.

- `docker-service.ts`: construye e inicia el contenedor, obtiene el puerto dinámico, espera disponibilidad y detiene/elimina el contenedor.
- `docker-global-setup.ts`: conecta esa infraestructura con Vitest para los E2E API.
- `playwright-global-setup.ts`: conecta esa infraestructura con Playwright para los E2E UI.
- `vitest-context.ts`: permite compartir con Vitest datos como la URL dinámica del contenedor.

Normalmente estos archivos no se ejecutan manualmente. Se usan indirectamente mediante `pnpm test:e2e:api`, `pnpm test:e2e:ui` o `pnpm test:e2e`.
